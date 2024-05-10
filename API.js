const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("./connectDB");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

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
        (accounts.username = $1 OR profiles.email = $1)`;
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

    if (account.status === "Inactive") {
      return res
        .status(401)
        .json({
          message:
            "Tài khoản của bạn hiện đang bị vô hiệu hóa hoặc chưa được kích hoạt. Vui lòng liên hệ với Tour Travel.",
        });
    }

    const token = jwt.sign(
      { account_id: account.account_id, username: account.username },
      "your_secret_key"
    );
    res.json({
      token,
      role: account.role_id,
      username: account.username,
      account_id: account.account_id,
    });
  } catch (error) {
    console.error("Đăng nhập không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng nhập không thành công. Vui lòng thử lại sau." });
  }
});
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401); 

  jwt.verify(token, "your_secret_key", (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next(); 
  });
}
function generateRandomCode(length) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "hieu01211@gmail.com",
    pass: process.env.PASS,
  },
});

app.post("/register", async (req, res) => {
  const {
    username,
    password,
    name,
    birth_of_date,
    phone_number,
    address,
    email,
  } = req.body;

  try {
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

    const passwordHash = bcrypt.hashSync(password, 10);

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

    const accountQuery =
      "INSERT INTO accounts (username, password, profile_id, role_id, status, confirmation_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *";
    const confirmationCode = generateRandomCode(5);
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      profile.profile_id,
      1,
      "Inactive",
      confirmationCode,
    ]);

    const account = accountResult.rows[0];

    const referralCode = generateRandomCode(5);
    const customerQuery =
      "INSERT INTO customers (account_id, referral_code) VALUES ($1, $2) RETURNING *";
    await pool.query(customerQuery, [account.account_id, referralCode]);

    const confirmationLink = `http://localhost:3000/confirm`;

    const mailOptions = {
      from: "Tour Travel",
      to: email,
      subject: "Yêu Cầu Kích Hoạt Tài Khoản",
      html: `Mã kích hoạt tài khoản : <h2>${confirmationCode}</h2>
            Chúng tôi hy vọng rằng bạn đang có một ngày tốt lành. Chúng tôi xin gửi email này để nhắc nhở về việc kích hoạt tài khoản của bạn trên hệ thống của chúng tôi.<br/>
            Tài khoản của bạn đã được tạo sẵn trên nền tảng của chúng tôi, nhưng hiện tại nó vẫn chưa được kích hoạt. Để tiếp tục trải nghiệm các tính năng và dịch vụ mà chúng tôi cung cấp, chúng tôi rất mong bạn có thể hoàn tất quá trình kích hoạt.<br/>
            Vui lòng truy cập ${confirmationLink} và làm theo hướng dẫn để hoàn tất quá trình kích hoạt tài khoản của bạn. Nếu bạn gặp bất kỳ vấn đề hoặc cần sự trợ giúp, đừng ngần ngại liên hệ với chúng tôi thông qua email này .<br/>
            Chúng tôi trân trọng sự hợp tác của bạn và mong nhận được phản hồi từ bạn trong thời gian sớm nhất.<br/>
            Trân trọng,<br/>
            Tour Travel<br/>
            Admin`,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.log("Gửi email không thành công:", error);
      } else {
        console.log("Email xác nhận đã được gửi: " + info.response);
      }
    });

    res.json({ message: "Đăng ký thành công!", referral_code: referralCode });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});
app.get("/confirm/:confirmationCode", async (req, res) => {
  const confirmationCode = req.params.confirmationCode;

  try {
    const accountQuery =
      "UPDATE accounts SET status = 'Active' WHERE confirmation_code = $1 RETURNING *";
    const confirmedAccount = await pool.query(accountQuery, [confirmationCode]);

    if (confirmedAccount.rows.length === 0) {
      return res.status(404).json({ message: "Mã xác nhận không hợp lệ." });
    }

    res.json({ message: "Xác nhận đăng ký thành công!" });
  } catch (error) {
    console.error("Xác nhận đăng ký không thành công:", error);
    res
      .status(500)
      .json({
        message: "Xác nhận đăng ký không thành công. Vui lòng thử lại sau.",
      });
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
       "INSERT INTO accounts (username, password, profile_id, role_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *";
     const accountResult = await pool.query(accountQuery, [
       username,
       passwordHash,
       profile.profile_id,
       3,
       "Active",
     ]);

    const account = accountResult.rows[0];
   

    res.json({ message: "Đăng ký thành công!"});
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});
app.post("/register-guides/:accountId", async (req, res) => {
  const { username, password, name, birth_of_date, phone_number, address } =
    req.body;
  const { accountId } = req.params;

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
      "INSERT INTO accounts (username, password, profile_id, role_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *";
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      profile.profile_id,
      4,
      "Active",
    ]);

    const account = accountResult.rows[0];
    const customerQuery =
      "INSERT INTO guides (account_id, account_business_id) VALUES ($1, $2) RETURNING *";
    await pool.query(customerQuery, [account.account_id, accountId]);

    res.json({ message: "Đăng ký thành công!" });
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
      SELECT accounts.username, accounts.status, profiles.name, profiles.birth_of_date, profiles.phone_number, profiles.address, profiles.email
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
  const { username, name, birth_of_date, phone_number, address,status } =
    req.body;

  try {
    const updateQuery = `
      UPDATE profiles
      SET name = $1, birth_of_date = $2, phone_number = $3, address = $4
      FROM accounts
      WHERE accounts.profile_id = profiles.profile_id
        AND accounts.account_id = $5
    `;
    await pool.query(updateQuery, [
      name,
      birth_of_date,
      phone_number,
      address,
      accountId,
    ]);

    const updateUsernameQuery = `
      UPDATE accounts
      SET username = $1, status= $2
      WHERE account_id = $3
    `;
    await pool.query(updateUsernameQuery, [username, status, accountId]);

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
      SELECT profiles.profile_id, accounts.username,accounts.status,  accounts.account_id, accounts.role_id, profiles.name, profiles.birth_of_date, 
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
app.get("/get-guides-by-business", async (req, res) => {
  const { account_business_id } = req.query;

  try {
    const query = `
      SELECT guides.guide_id, guides.account_id, guides.account_business_id,
             accounts.username, accounts.status,accounts.role_id,
             profiles.name, profiles.profile_id, profiles.birth_of_date, profiles.phone_number,
             profiles.address, profiles.email
      FROM guides
      INNER JOIN accounts ON guides.account_id = accounts.account_id
      INNER JOIN profiles ON accounts.profile_id = profiles.profile_id
      WHERE guides.account_business_id = $1
    `;
    const result = await pool.query(query, [account_business_id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách hướng dẫn viên:", error);
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
app.get('/news-categories',authenticateToken, async (req, res) => {
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
    const query = "SELECT status, note,title,content FROM news WHERE news_id = $1";
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
app.put("/update-news/:newsId", async (req, res) => {
  const { newsId } = req.params;
  const { title, content } = req.body;

  try {
    const query = "UPDATE news SET title = $1, content = $2 WHERE news_id = $3";
    await pool.query(query, [title, content, newsId]);

    res.status(200).json({ message: "News updated successfully" });
  } catch (error) {
    console.error("Failed to update news:", error);
    res.status(500).json({ message: "Failed to update news" });
  }
});
app.get("/list-news-travel/:category", async (req, res) => {
  try {
    const category = req.params.category;
    const query = `
      SELECT n.news_id, n.title, n.content, nc.name as category_name, p.name as profile_name, n.created_at, n.status, n.note, ni.image
      FROM news n
      LEFT JOIN newscategories nc ON n.newscategory_id = nc.newscategory_id
      LEFT JOIN profiles p ON n.account_id = p.profile_id
      LEFT JOIN newsimages ni ON n.news_id = ni.news_id
      WHERE n.status = 'Confirm' AND nc.name = $1
    `;
    const result = await pool.query(query, [category]);

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
app.post("/send-contact", async (req, res) => {
  const { fullname, email, phonenumber, message, address } = req.body;

  try {
    const query = `
      INSERT INTO contacts (fullname, email, phonenumber, message, senttime, address, status)
      VALUES ($1, $2, $3, $4, NOW(), $5, 'Pending')
    `;
    await pool.query(query, [fullname, email, phonenumber, message, address]);

    res.status(201).json({ message: "Gửi thông tin liên hệ thành công !" });
  } catch (error) {
    console.error("Failed to send contact:", error);
    res.status(500).json({ message: "Gửi thông tin liên hệ thất bại !" });
  }
});
app.get("/get-contacts", async (req, res) => {
  try {
    const query = "SELECT * FROM contacts";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch contacts:", error);
    res.status(500).json({ message: "Failed to fetch contacts" });
  }
});
app.get("/contacts-detail/:contactId", async (req, res) => {
  const { contactId } = req.params;

  try {
    const query = "SELECT * FROM contacts WHERE contact_id = $1";
    const result = await pool.query(query, [contactId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Contact not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch contact:", error);
    res.status(500).json({ message: "Failed to fetch contact" });
  }
});
app.put("/update-status-contact/:contactId", async (req, res) => {
  const { contactId } = req.params;
  const { status } = req.body;

  try {
    const query = `
      UPDATE contacts 
      SET status = $1
      WHERE contact_id = $2
    `;
    await pool.query(query, [status, contactId]);

    res
      .status(200)
      .json({ message: "News status and note updated successfully" });
  } catch (error) {
    console.error("Failed to update news status and note:", error);
    res.status(500).json({ message: "Failed to update news status and note" });
  }
});

app.post("/add-hotels/:account_id", async (req, res) => {
  const account_id = req.params.account_id;
  const { name, star, address, contact_info } = req.body;

  try {
    const newHotel = await pool.query(
      "INSERT INTO hotels (name, star, address, contact_info, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, star, address, contact_info, account_id]
    );

    res.json(newHotel.rows[0]);
  } catch (err) {
    console.error("Error adding hotel:", err.message);
    res.status(500).send("Server Error");
  }
});
app.get("/list-hotels/:account_id", async (req, res) => {
  const { account_id } = req.params;

  try {
    const hotels = await pool.query(
      "SELECT hotel_id, name, star, address, contact_info FROM hotels WHERE account_id = $1",
      [account_id]
    );

    res.json(hotels.rows);
  } catch (err) {
    console.error("Error fetching hotels:", err.message);
    res.status(500).send("Server Error");
  }
});
app.get("/select-hotel/:hotelsId", async (req, res) => {
  const { hotelsId } = req.params;

  try {
    const query =
      "SELECT name, star, address, contact_info FROM hotels WHERE hotel_id = $1";
    const result = await pool.query(query, [hotelsId]);
    const details = result.rows[0];
    res.json(details);
  } catch (error) {
    console.error("Failed to fetch hotel details:", error);
    res.status(500).json({ message: "Failed to fetch hotel details" });
  }
});
app.put("/update-hotel/:hotelsId", async (req, res) => {
  const { hotelsId } = req.params;
  const { name, star, address, contact_info } = req.body;

  try {
    const query = `
      UPDATE hotels 
      SET name = $1, star= $2, address= $3, contact_info= $4
      WHERE hotel_id = $5
    `;
    await pool.query(query, [name, star, address, contact_info, hotelsId]);

    res
      .status(200)
      .json({ message: "Hotels updated successfully" });
  } catch (error) {
    console.error("Failed to hotels:", error);
    res.status(500).json({ message: "Failed to update hotels" });
  }
});
app.delete("/delete-hotel/:hotelsId", async (req, res) => {
  const { hotelsId } = req.params;

  try {
    const query = "DELETE FROM hotels WHERE hotel_id = $1";
    await pool.query(query, [hotelsId]);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete news:", error);
    res.status(500).json({ message: "Failed to delete news" });
  }
});
app.post("/add-vehicles/:account_id", async (req, res) => {
  const account_id = req.params.account_id;
  const { type, description } = req.body;

  try {
    const newVehicle = await pool.query(
      "INSERT INTO vehicles (type, description, account_id) VALUES ($1, $2, $3) RETURNING *",
      [type, description, account_id]
    );

    res.json(newVehicle.rows[0]);
  } catch (err) {
    console.error("Error adding hotel:", err.message);
    res.status(500).send("Server Error");
  }
});
app.get("/list-vehicles/:account_id", async (req, res) => {
  const { account_id } = req.params;

  try {
    const vehicles = await pool.query(
      "SELECT vehicle_id, type, description FROM vehicles WHERE account_id = $1",
      [account_id]
    );

    res.json(vehicles.rows);
  } catch (err) {
    console.error("Error fetching vehicles:", err.message);
    res.status(500).send("Server Error");
  }
});
app.get("/select-vehicle/:vehiclesId", async (req, res) => {
  const { vehiclesId } = req.params;

  try {
    const query =
      "SELECT type, description FROM vehicles WHERE vehicle_id = $1";
    const result = await pool.query(query, [vehiclesId]);
    const details = result.rows[0];
    res.json(details);
  } catch (error) {
    console.error("Failed to fetch vehicle details:", error);
    res.status(500).json({ message: "Failed to fetch vehicle details" });
  }
});
app.put("/update-vehicle/:vehiclesId", async (req, res) => {
  const { vehiclesId } = req.params;
  const { type, description } = req.body;

  try {
    const query = `
      UPDATE vehicles 
      SET type = $1, description= $2
      WHERE vehicle_id = $3
    `;
    await pool.query(query, [type, description, vehiclesId]);

    res.status(200).json({ message: "Vehicles updated successfully" });
  } catch (error) {
    console.error("Failed to vehicles:", error);
    res.status(500).json({ message: "Failed to update vehicles" });
  }
});
app.delete("/delete-vehicle/:vehiclesId", async (req, res) => {
  const { vehiclesId } = req.params;

  try {
    const query = "DELETE FROM vehicles WHERE vehicle_id = $1";
    await pool.query(query, [vehiclesId]);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete news:", error);
    res.status(500).json({ message: "Failed to delete news" });
  }
});

// -----------------------------------------------
module.exports = app;
