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


// -----------------------------------------------
module.exports = app;
