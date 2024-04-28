const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("./connectDB");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");

pool.connect((err) => {
  if (err) {
    console.error("Postgres connection error:", err);
  } else {
    console.log("Connected to Postgres");
  }
});

app.post("/login", async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  try {
    const query = `
      SELECT 
        accounts.*
        
      FROM 
        accounts 
      LEFT JOIN 
        profiles ON accounts.profile_id = profiles.profile_id
      WHERE 
        accounts.username = $1 OR profiles.email = $1`;
    const result = await pool.query(query, [usernameOrEmail]);
    const account = result.rows[0];

    if (!account) {
      return res
        .status(404)
        .json({ message: "Tên đăng nhập hoặc email không tồn tại." });
    }

    if (!bcrypt.compareSync(password, account.password)) {
      return res.status(401).json({ message: "Mật khẩu không chính xác." });
    }

    const token = jwt.sign(
      { account_id: account.account_id, username: account.username },
      "secret_key"
    );
    res.json({
      token,
      role: account.role_id,
      username:account.username,
      account_id: account.account_id,
  
    });
  } catch (error) {
    console.error("Đăng nhập không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng nhập không thành công. Vui lòng thử lại sau." });
  }
});

function generateRandomCode(length) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

app.post("/register", async (req, res) => {
  const { username, password, name, birth_of_date, phone_number, address } =
    req.body;

  try {
    const { email } = req.body; 

    const checkExistingQuery =
      "SELECT * FROM accounts INNER JOIN profiles ON accounts.profile_id = profiles.profile_id WHERE username = $1 OR profiles.email = $2";
    const existingResult = await pool.query(checkExistingQuery, [
      username,
      email,
    ]);
    if (existingResult.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "Tên đăng nhập hoặc email đã tồn tại." });
    }

    const profileQuery =
      "INSERT INTO profiles (name, birth_of_date, phone_number, address, email) VALUES ($1, $2, $3, $4, $5) RETURNING *";
    const profileResult = await pool.query(profileQuery, [
      name,
      birth_of_date,
      phone_number,
      address,
      email,
    ]);
    const profile = profileResult.rows[0];

    const passwordHash = bcrypt.hashSync(password, 10);
    const accountQuery =
      "INSERT INTO accounts (username, password, profile_id, role_id) VALUES ($1, $2, $3, $4) RETURNING *";
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      profile.profile_id,
      1,
    ]); 
    const account = accountResult.rows[0];

    const userQuery = "INSERT INTO users (account_id) VALUES ($1) RETURNING *";
    const userResult = await pool.query(userQuery, [account.account_id]);
    const user = userResult.rows[0];

    const referralCode = generateRandomCode(5);
    const customerQuery =
      "INSERT INTO customers (user_id, referral_code) VALUES ($1, $2) RETURNING *";
    await pool.query(customerQuery, [user.user_id, referralCode]);

    res.json({ message: "Đăng ký thành công!", referral_code: referralCode });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});
app.get("/account/:id", async (req, res) => {
  const accountId = req.params.id;

  try {
    const query = `
      SELECT accounts.username, profiles.name, profiles.birth_of_date, profiles.phone_number, profiles.address, profiles.email
      FROM accounts
      INNER JOIN profiles ON accounts.profile_id = profiles.profile_id
      WHERE accounts.account_id = $1
    `;
    const result = await pool.query(query, [accountId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy thông tin tài khoản." });
    }

    const accountData = result.rows[0];
    res.json(accountData);
  } catch (error) {
    console.error("Lỗi khi lấy thông tin tài khoản:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});

app.put("/account/:id", async (req, res) => {
  const accountId = req.params.id;
  const { username, name, birth_of_date, phone_number, address, email } =
    req.body;

  try {
    const updateQuery = `
      UPDATE profiles
      SET name = $1, birth_of_date = $2, phone_number = $3, address = $4, email = $5
      FROM accounts
      WHERE accounts.profile_id = profiles.profile_id
        AND accounts.account_id = $6
    `;
    await pool.query(updateQuery, [
      name,
      birth_of_date,
      phone_number,
      address,
      email,
      accountId,
    ]);

    res.json({ message: "Thông tin tài khoản đã được cập nhật." });
  } catch (error) {
    console.error("Lỗi khi cập nhật thông tin tài khoản:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});
app.put("/account/change-password/:id", async (req, res) => {
  const accountId = req.params.id;
  const { oldPassword, newPassword, confirmPassword } = req.body;

  try {
    const getPasswordQuery =
      "SELECT password FROM accounts WHERE account_id = $1";
    const getPasswordResult = await pool.query(getPasswordQuery, [accountId]);
    const currentPasswordHash = getPasswordResult.rows[0].password;

    const isPasswordMatch = await bcrypt.compare(
      oldPassword,
      currentPasswordHash
    );
    if (!isPasswordMatch) {
      return res.status(401).json({ message: "Mật khẩu cũ không đúng." });
    }

    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới và nhập lại mật khẩu mới không khớp." });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    const updatePasswordQuery =
      "UPDATE accounts SET password = $1 WHERE account_id = $2";
    await pool.query(updatePasswordQuery, [newPasswordHash, accountId]);

    res.json({ message: "Mật khẩu đã được thay đổi." });
  } catch (error) {
    console.error("Lỗi khi thay đổi mật khẩu:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});

// -----------------------------------------------
module.exports = app;
