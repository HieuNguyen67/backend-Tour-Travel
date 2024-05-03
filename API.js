const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("./connectDB");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const fs = require('fs').promises; 

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
app.post("/register-business", async (req, res) => {
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
      3,
    ]);
    const account = accountResult.rows[0];

    const userQuery = "INSERT INTO users (account_id) VALUES ($1) RETURNING *";
    const userResult = await pool.query(userQuery, [account.account_id]);
    const user = userResult.rows[0];

   

    res.json({ message: "Đăng ký thành công!"});
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

app.get("/account/image/:accountId", async (req, res) => {
  const { accountId } = req.params;

  try {
    const query = "SELECT image FROM accountsimage WHERE account_id = $1";
    const result = await pool.query(query, [accountId]);

    if (result.rows.length > 0) {
      const imageData = result.rows[0].image;
      res.set("Content-Type", "image/jpeg"); 
      res.send(imageData);
    } else {
      res
        .status(404)
        .json({ message: "Không tìm thấy hình ảnh cho tài khoản này." });
    }
  } catch (error) {
    console.error("Lỗi khi lấy hình ảnh:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.put(
  "/account/update-image/:accountId",
  upload.single("image"),
  async (req, res) => {
    const { accountId } = req.params;
    const { buffer } = req.file; 

    try {
      const checkImageQuery =
        "SELECT * FROM accountsimage WHERE account_id = $1";
      const checkImageResult = await pool.query(checkImageQuery, [accountId]);

      if (checkImageResult.rows.length > 0) {
        const updateImageQuery =
          "UPDATE accountsimage SET image = $1 WHERE account_id = $2";
        await pool.query(updateImageQuery, [buffer, accountId]);
      } else {
        const insertImageQuery =
          "INSERT INTO accountsimage (account_id, image) VALUES ($1, $2)";
        await pool.query(insertImageQuery, [accountId, buffer]);
      }

      res.json({ message: "Hình ảnh đã được cập nhật." });
    } catch (error) {
      console.error("Lỗi khi cập nhật hình ảnh:", error);
      res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
    }
  }
);
app.get("/get-users", async (req, res) => {
  const { role_id } = req.query;

  try {
    const query = `
      SELECT profiles.profile_id, accounts.username,  accounts.account_id, accounts.role_id, profiles.name, profiles.birth_of_date, 
             profiles.phone_number, profiles.address, profiles.email
      FROM profiles
      INNER JOIN accounts ON profiles.profile_id = accounts.profile_id
      WHERE accounts.role_id = $1
    `;
    const result = await pool.query(query, [role_id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});
app.delete("/delete-users/:profileId", async (req, res) => {
  const profileId = req.params.profileId;

  try {
    await pool.query("DELETE FROM profiles WHERE profile_id = $1", [profileId]);

    res.json({ message: "Người dùng đã được xoá thành công." });
  } catch (error) {
    console.error("Lỗi khi xoá người dùng:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});

app.post("/add-newscategories", async (req, res) => {
  const { name } = req.body;

  try {
    const query = "INSERT INTO NewsCategories (name) VALUES ($1) RETURNING *";
    const result = await pool.query(query, [name]);
    const newCategory = result.rows[0];
    res.status(201).json(newCategory);
  } catch (error) {
    console.error("Error adding news category:", error);
    res.status(500).json({ message: "Failed to add news category." });
  }
});
app.get('/news-categories', async (req, res) => {
  try {
    const categories = await pool.query('SELECT * FROM NewsCategories');
    res.json(categories.rows);
  } catch (error) {
    console.error('Failed to fetch news categories:', error);
    res.status(500).json({ message: 'Failed to fetch news categories.' });
  }
});

app.post("/add-news", upload.single("image"), async (req, res) => {
  const { title, content, newscategory_id, account_id } = req.body;

  try {
    const newsInsertQuery = `
      INSERT INTO News (title, content, newscategory_id, account_id, created_at, status)
      VALUES ($1, $2, $3, $4, NOW(), 'Pending')
      RETURNING news_id
    `;
    const newsInsertValues = [title, content, newscategory_id, account_id];
    const newsInsertResult = await pool.query(
      newsInsertQuery,
      newsInsertValues
    );

    const newsId = newsInsertResult.rows[0].news_id;

    if (req.file) {
      const imageInsertQuery = `
        INSERT INTO NewsImages (news_id, image)
        VALUES ($1, $2)
      `;
      const imageInsertValues = [newsId, req.file.buffer];
      await pool.query(imageInsertQuery, imageInsertValues);
    }

    res
      .status(201)
      .json({ message: "News posted successfully", news_id: newsId });
  } catch (error) {
    console.error("Error posting news:", error);
    res
      .status(500)
      .json({ message: "Failed to post news. Please try again later." });
  }
});
app.get("/list-news", async (req, res) => {
  try {
    const query = `
      SELECT n.news_id, n.title, n.content, nc.name as category_name, p.name as profile_name, n.created_at, n.status, n.note, ni.image
      FROM news n
      LEFT JOIN newscategories nc ON n.newscategory_id = nc.newscategory_id
      LEFT JOIN profiles p ON n.account_id = p.profile_id
      LEFT JOIN newsimages ni ON n.news_id = ni.news_id
    `;
    const result = await pool.query(query);

    const newsWithBase64Images = result.rows.map((row) => {
      if (row.image) {
        const imageBase64 = Buffer.from(row.image, "binary").toString("base64");
        return { ...row, image: imageBase64 };
      } else {
        return row;
      }
    });

    res.json(newsWithBase64Images);
  } catch (error) {
    console.error("Failed to fetch news:", error);
    res.status(500).json({ message: "Failed to fetch news" });
  }
});
app.get("/news-detail/:newsId", async (req, res) => {
  const { newsId } = req.params;
  
  try {
    const query = `
      SELECT 
          n.news_id, 
          n.title, 
          n.content, 
          nc.name AS newscategory_name, 
          p.name AS profile_name, 
          n.created_at
      FROM 
          news n
      INNER JOIN 
          newscategories nc ON n.newscategory_id = nc.newscategory_id
      INNER JOIN 
          profiles p ON n.account_id = p.profile_id
      WHERE 
          n.news_id = $1;
    `;
    const result = await pool.query(query, [newsId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch news:", error);
    res.status(500).json({ message: "Failed to fetch news" });
  }
});
app.delete("/delete-news/:newsId", async (req, res) => {
  const { newsId } = req.params;

  try {
    const query = "DELETE FROM news WHERE news_id = $1"; 
    await pool.query(query, [newsId]); 

    res.status(204).send(); 
  } catch (error) {
    console.error("Failed to delete news:", error);
    res.status(500).json({ message: "Failed to delete news" }); 
  }
});
app.get("/select-status-note/:newsId", async (req, res) => {
  const { newsId } = req.params;

  try {
    const query = "SELECT status, note FROM news WHERE news_id = $1";
    const result = await pool.query(query, [newsId]);
    const details = result.rows[0];
    res.json(details);
  } catch (error) {
    console.error("Failed to fetch news details:", error);
    res.status(500).json({ message: "Failed to fetch news details" });
  }
});
app.put("/update-status/:newsId", async (req, res) => {
  const { newsId } = req.params;
  const { status, note } = req.body;

  try {
    const query = `
      UPDATE news 
      SET status = $1, note = $2 
      WHERE news_id = $3
    `;
    await pool.query(query, [status, note, newsId]);

    res
      .status(200)
      .json({ message: "News status and note updated successfully" });
  } catch (error) {
    console.error("Failed to update news status and note:", error);
    res.status(500).json({ message: "Failed to update news status and note" });
  }
});
// -----------------------------------------------
module.exports = app;
