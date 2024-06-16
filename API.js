const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("./connectDB");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const moment = require("moment-timezone");

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
       a.*, bs.business_id, c.customer_id, ad.admin_id
      FROM 
        accounts a
      LEFT JOIN business bs ON a.account_id = bs.account_id
      LEFT JOIN customers c ON a.account_id = c.account_id
      LEFT JOIN admin ad ON a.account_id = ad.account_id
      WHERE 
        (username = $1 OR email = $1)`;
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
      if (account.use_confirmation_code === "unused") {
        var message =
          "Bạn chưa kích hoạt tài khoản. Vui lòng kiểm tra email để kích hoạt !";
      } else {
        if (account.note) {
          var message = " " + account.note;
        }
      }

      return res.status(401).json({ message });
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
      business_id: account.business_id,
      customer_id: account.customer_id,
      admin_id: account.admin_id
    });
  } catch (error) {
    console.error("Đăng nhập không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng nhập không thành công. Vui lòng thử lại sau." });
  }
});

//-----------------------------------------------
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
      "SELECT * FROM accounts WHERE username = $1 OR email = $2";
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

    const accountQuery =
      "INSERT INTO accounts (username, password, role_id, status, confirmation_code, use_confirmation_code, name, birth_of_date, phone_number, address, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *";
    const confirmationCode = generateRandomCode(5);
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      1,
      "Inactive",
      confirmationCode,
      "unused",
      name,
      birth_of_date,
      phone_number,
      address,
      email,
    ]);

    const account = accountResult.rows[0];

    const customerQuery =
      "INSERT INTO customers (account_id) VALUES ($1) RETURNING *";
    await pool.query(customerQuery, [account.account_id]);

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

    res.json({ message: "Đăng ký thành công!" });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});
//-----------------------------------------------
app.get("/confirm/:confirmationCode", async (req, res) => {
  const confirmationCode = req.params.confirmationCode;

  try {
    const checkQuery = "SELECT * FROM accounts WHERE confirmation_code = $1";
    const checkResult = await pool.query(checkQuery, [confirmationCode]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Mã xác nhận không hợp lệ." });
    }

    const account = checkResult.rows[0];

    if (account.use_confirmation_code === "used") {
      return res.status(400).json({ message: "Mã xác nhận đã được sử dụng." });
    }

    const updateQuery = `
      UPDATE accounts 
      SET status = 'Active', use_confirmation_code = 'used' 
      WHERE confirmation_code = $1 
      RETURNING *
    `;
    const updateResult = await pool.query(updateQuery, [confirmationCode]);

    res.json({ message: "Xác nhận đăng ký thành công!" });
  } catch (error) {
    console.error("Xác nhận đăng ký không thành công:", error);
    res.status(500).json({
      message: "Xác nhận đăng ký không thành công. Vui lòng thử lại sau.",
    });
  }
});

//-----------------------------------------------
app.post("/register-business/:adminId", authenticateToken, async (req, res) => {
  const {
    username,
    password,
    name,
    birth_of_date,
    phone_number,
    address,
    email,
  } = req.body;
  const adminId = req.params.adminId;

  try {
    const checkExistingQuery =
      "SELECT * FROM accounts WHERE username = $1 OR email = $2";
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

    const accountQuery =
      "INSERT INTO accounts (username, password, role_id, status, confirmation_code, use_confirmation_code, name, birth_of_date, phone_number, address, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *";
    const confirmationCode = generateRandomCode(5);
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      3,
      "Inactive",
      confirmationCode,
      "unused",
      name,
      birth_of_date,
      phone_number,
      address,
      email,
    ]);

    const account = accountResult.rows[0];

    const businessQuery =
      "INSERT INTO business (account_id) VALUES ($1) RETURNING *";
    await pool.query(businessQuery, [account.account_id]);

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

    const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    const action = "Đăng ký tài khoản doanh nghiệp !";
    const actionTime = new Date().toISOString();
    const objectType = "accounts";

    await pool.query(insertAdminActionQuery, [
      adminId,
      account.account_id,
      action,
      actionTime,
      objectType,
    ]);

    res.json({ message: "Đăng ký thành công!" });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});

app.post("/register-admin/:adminId", authenticateToken, async (req, res) => {
  const {
    username,
    password,
    name,
    birth_of_date,
    phone_number,
    address,
    email,
    role,
  } = req.body;
  const adminId = req.params.adminId;

  try {
    const checkExistingQuery =
      "SELECT * FROM accounts WHERE username = $1 OR email = $2";
    const existingResult = await pool.query(checkExistingQuery, [
      username,
      email,
    ]);
    if (existingResult.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "Tên đăng nhập hoặc email đã tồn tại." });
    }

    const checkRoleExistQuery =
      "SELECT * FROM accounts WHERE role_id = $1 and status= 'Active'";
    const roleExistResult = await pool.query(checkRoleExistQuery, [role]);
    if (roleExistResult.rows.length > 0) {
      return res
        .status(400)
        .json({
          message:
            "Đã có quản trị viên thuộc quyền này quản lý này. Vui lòng khoá tài khoản cũ để tạo mới!",
        });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const accountQuery =
      "INSERT INTO accounts (username, password, role_id, status, confirmation_code, use_confirmation_code, name, birth_of_date, phone_number, address, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *";
    const confirmationCode = generateRandomCode(5);
    const accountResult = await pool.query(accountQuery, [
      username,
      passwordHash,
      role,
      "Inactive",
      confirmationCode,
      "unused",
      name,
      birth_of_date,
      phone_number,
      address,
      email,
    ]);

    const account = accountResult.rows[0];

    const businessQuery =
      "INSERT INTO admin (account_id) VALUES ($1) RETURNING *";
    await pool.query(businessQuery, [account.account_id]);

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

    const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    const action = "Đăng ký tài khoản quản trị viên !";
    const actionTime = new Date().toISOString();
    const objectType = "accounts";

    await pool.query(insertAdminActionQuery, [
      adminId,
      account.account_id,
      action,
      actionTime,
      objectType,
    ]);

    res.json({ message: "Đăng ký thành công!" });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});


app.get("/account/:id", authenticateToken, async (req, res) => {
  const accountId = req.params.id;
  const role = req.query.role;

  try {
    let query = "";
    let values = [accountId];

    if (role === "1") {
      query = `
        SELECT a.username, a.status, a.name, a.birth_of_date, a.phone_number, a.address, a.email, 
               c.bank_account_name, c.bank_account_number,c.bank_name, a.note
        FROM accounts a
        LEFT JOIN customers c ON a.account_id = c.account_id
        WHERE a.account_id = $1
      `;
    } else if (role === "3") {
      query = `
        SELECT a.username, a.status, a.name, a.birth_of_date, a.phone_number, a.address, a.email, 
               b.bank_account_name, b.bank_account_number,b.bank_name, a.note
        FROM accounts a
        LEFT JOIN business b ON a.account_id = b.account_id
        WHERE a.account_id = $1
      `;
    } else {
      query = `
        SELECT a.username,r.role_name,a.account_id, a.status, a.name, a.birth_of_date, a.phone_number, a.address, a.email
        FROM accounts a
         LEFT JOIN role r ON a.role_id = r.role_id
        WHERE a.account_id = $1
      `;
    }

    const result = await pool.query(query, values);

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

app.put("/account/:id", authenticateToken, async (req, res) => {
  const accountId = req.params.id;
  const {
    username,
    name,
    birth_of_date,
    phone_number,
    address,
    status,
    bank_account_name,
    bank_account_number,
    bank_name,
    note,
  } = req.body;
  const role = req.query.role;

  try {
    let updateAccountQuery = `
      UPDATE accounts
      SET username = $1, name = $2, birth_of_date = $3, phone_number = $4, address = $5, status = $6, note = $7
      WHERE account_id = $8
    `;
    let values = [
      username,
      name,
      birth_of_date,
      phone_number,
      address,
      status,
      note,
      accountId,
    ];

    await pool.query(updateAccountQuery, values);

    if (role === "1") {
      let updateCustomerQuery = `
        UPDATE customers
        SET bank_account_name = $1, bank_account_number = $2, bank_name=$3
        WHERE account_id = $4
      `;
      let customerValues = [
        bank_account_name,
        bank_account_number,
        bank_name,
        accountId,
      ];

      await pool.query(updateCustomerQuery, customerValues);
    } else if (role === "3") {
      let updateBusinessQuery = `
        UPDATE business
        SET bank_account_name = $1, bank_account_number = $2, bank_name=$3
        WHERE account_id = $4
      `;
      let businessValues = [
        bank_account_name,
        bank_account_number,
        bank_name,
        accountId,
      ];

      await pool.query(updateBusinessQuery, businessValues);
    }

    res.json({ message: "Thông tin tài khoản đã được cập nhật." });
  } catch (error) {
    console.error("Lỗi khi cập nhật thông tin tài khoản:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});
app.put("/update-status-accounts/:accountId/:adminId", authenticateToken, async (req, res) => {
  const { accountId, adminId } = req.params;
  const { status, note } = req.body; 

  try {
    await pool.query("BEGIN");

    const updateAccountStatusQuery = `
      UPDATE accounts 
      SET status = $1 , note = $2
      WHERE account_id = $3
    `;
    await pool.query(updateAccountStatusQuery, [status, note, accountId]);

    const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    const action = "Cập nhật trạng thái tài khoản !";
    const actionTime = new Date().toISOString();
    const objectType = "accounts";

    await pool.query(insertAdminActionQuery, [
      adminId,
      accountId,
      action,
      actionTime,
      objectType,
    ]);

    await pool.query("COMMIT");

    res
      .status(200)
      .json({
        message: "Cập nhật tài khoản thành công !",
      });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Lỗi khi cập nhật tài khoản:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/account/change-password/:id", authenticateToken, async (req, res) => {
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
    const query = "SELECT image FROM accounts WHERE account_id = $1";
    const result = await pool.query(query, [accountId]);

    const imageData = result.rows[0].image;
    if (imageData != null) {
      res.set("Content-Type", "image/jpeg");
      res.send(imageData);
    } else {
      res.status(404).json({ message: "Không có hình ảnh cho tài khoản này." });
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
  authenticateToken,
  upload.single("image"),
  async (req, res) => {
    const { accountId } = req.params;
    const { buffer } = req.file;

    try {
      const checkImageQuery = "SELECT * FROM accounts WHERE account_id = $1";
      const checkImageResult = await pool.query(checkImageQuery, [accountId]);

      if (checkImageResult.rows.length > 0) {
        const updateImageQuery =
          "UPDATE accounts SET image = $1 WHERE account_id = $2";
        await pool.query(updateImageQuery, [buffer, accountId]);
      } else {
        const insertImageQuery =
          "INSERT INTO accounts (image) VALUES ($1) WHERE account_id = $2";
        await pool.query(insertImageQuery, [buffer, accountId]);
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
      SELECT  username, status, account_id, role_id, name, birth_of_date, 
             phone_number,address, email, image
      FROM accounts
      WHERE role_id = $1
    `;
    const result = await pool.query(query, [role_id]);
    const accounts = result.rows.map((row) => ({
      ...row,
      image: row.image ? row.image.toString("base64") : null,
    }));

    res.json(accounts);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau." });
  }
});
app.get("/get-admins",authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        a.name,
        a.status,
        a.birth_of_date,
        a.phone_number,
        a.address,
        a.email,
        a.role_id,
        a.account_id,
        a.username,
        r.role_name
      FROM 
        admin ad
      JOIN 
        accounts a ON ad.account_id = a.account_id
      JOIN 
        role r ON a.role_id = r.role_id
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/news-categories", authenticateToken, async (req, res) => {
  try {
    const categories = await pool.query("SELECT * FROM NewsCategories");
    res.json(categories.rows);
  } catch (error) {
    console.error("Failed to fetch news categories:", error);
    res.status(500).json({ message: "Failed to fetch news categories." });
  }
});

app.post(
  "/add-news/:account_id/:adminId?",
  authenticateToken,
  upload.single("image"),
  async (req, res) => {
    const accountId = req.params.account_id;
    const adminId = req.params.adminId;
    const { title, content, newscategory_id } = req.body;

    try {
      let query = "";
      if (req.query.role === "3") {
        query = `
          INSERT INTO news (title, content, newscategory_id, posted_by_id_business, created_at, status, posted_by_type)
          VALUES ($1, $2, $3, $4, NOW(), 'Pending', 'business')
          RETURNING news_id`;
      } else {
        query = `
          INSERT INTO news (title, content, newscategory_id, posted_by_id_admin, created_at, status, posted_by_type)
          VALUES ($1, $2, $3, $4, NOW(), 'Pending', 'admin')
          RETURNING news_id`;
      }

      const newsInsertValues = [title, content, newscategory_id, accountId];
      const newsInsertResult = await pool.query(query, newsInsertValues);
      const newsId = newsInsertResult.rows[0].news_id;

      let imageInserted = false;
      if (req.file) {
        const imageInsertQuery = `
          UPDATE news SET image = $1 WHERE news_id = $2
        `;
        await pool.query(imageInsertQuery, [req.file.buffer, newsId]);
        imageInserted = true;
      }

      if(adminId){
        const adminActionQuery = `
        INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type)
        VALUES ($1, $2, $3, NOW(), $4)
      `;
        await pool.query(adminActionQuery, [
          adminId,
          newsId,
          "Thêm bài đăng tin tức",
          "news",
        ]);

      }
      

      if (imageInserted) {
        res
          .status(201)
          .json({ message: "News posted successfully", news_id: newsId });
      } else {
        res.status(400).json({ message: "Please upload an image file" });
      }
    } catch (error) {
      console.error("Error posting news:", error);
      res
        .status(500)
        .json({ message: "Failed to post news. Please try again later." });
    }
  }
);

app.get("/list-news/:account_id?", authenticateToken, async (req, res) => {
  try {
    const accountId = req.params.account_id;
    let query;
    const params = [];

    if (accountId) {
      query = `
        SELECT n.news_id, n.title, n.content, nc.name as category_name, a.name as profile_name, n.created_at, n.status, n.note, n.image
        FROM news n
        LEFT JOIN newscategories nc ON n.newscategory_id = nc.newscategory_id
               LEFT JOIN business b ON n.posted_by_type = 'business' AND n.posted_by_id_business = b.business_id
                LEFT JOIN accounts a ON b.account_id = a.account_id
        WHERE n.posted_by_id_business = $1 and n.posted_by_type= 'business'
      `;
      params.push(accountId);
    } else {
      query = `
              SELECT 
          n.news_id, 
          n.title, 
          n.content, 
          nc.name as category_name, 
          COALESCE(a.name, ab.name) as profile_name, 
          n.created_at, 
          n.status, 
          n.note, 
          n.image
          FROM 
          news n
          LEFT JOIN 
          newscategories nc ON n.newscategory_id = nc.newscategory_id
          LEFT JOIN 
          admin ad ON n.posted_by_type = 'admin' AND n.posted_by_id_admin = ad.admin_id
          LEFT JOIN 
          business b ON n.posted_by_type = 'business' AND n.posted_by_id_business = b.business_id
          LEFT JOIN 
          accounts a ON ad.account_id = a.account_id
          LEFT JOIN 
          accounts ab ON b.account_id = ab.account_id
         

      `;
    }

    const result = await pool.query(query, params);

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
          n.created_at,
          CASE
            WHEN n.posted_by_type = 'admin' THEN a.name
            WHEN n.posted_by_type = 'business' THEN a.name
            ELSE NULL
          END as profile_name
      FROM 
          news n
      LEFT JOIN newscategories nc ON n.newscategory_id = nc.newscategory_id
      LEFT JOIN admin ad ON n.posted_by_type = 'admin' AND n.posted_by_id_admin = ad.admin_id
      LEFT JOIN business b ON n.posted_by_type = 'business' AND n.posted_by_id_business = b.business_id
      LEFT JOIN accounts a ON (
        (n.posted_by_type = 'admin' AND ad.account_id = a.account_id) OR 
        (n.posted_by_type = 'business' AND b.account_id = a.account_id)
      )
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

app.delete(
  "/delete-news/:newsId/:adminId?",
  authenticateToken,
  async (req, res) => {
    const { newsId, adminId } = req.params;

    try {
      const deleteQuery = "DELETE FROM news WHERE news_id = $1";
      await pool.query(deleteQuery, [newsId]);

      if(adminId){
        const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
       const action = "Xoá bài đăng tin tức !";
       const actionTime = new Date().toISOString();
       const objectType = "news";

       await pool.query(insertAdminActionQuery, [
         adminId,
         newsId,
         action,
         actionTime,
         objectType,
       ]);

      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete news:", error);
      res.status(500).json({ message: "Failed to delete news" });
    }
  }
);
app.get("/select-status-note/:newsId", authenticateToken, async (req, res) => {
  const { newsId } = req.params;

  try {
    const query =
      "SELECT status, note,title,content FROM news WHERE news_id = $1";
    const result = await pool.query(query, [newsId]);
    const details = result.rows[0];
    res.json(details);
  } catch (error) {
    console.error("Failed to fetch news details:", error);
    res.status(500).json({ message: "Failed to fetch news details" });
  }
});
app.put(
  "/update-status-news/:newsId/:adminId",
  authenticateToken,
  async (req, res) => {
    const { newsId, adminId } = req.params;
    const { status, note } = req.body;

    try {
      const query = `
      UPDATE news 
      SET status = $1, note = $2
      WHERE news_id = $3
    `;
      await pool.query(query, [status, note, newsId]);

      const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
      const action = "Cập nhật trạng thái bài đăng tin tức !";
      const actionTime = new Date().toISOString();
      const objectType = "news";

      await pool.query(insertAdminActionQuery, [
        adminId,
        newsId,
        action,
        actionTime,
        objectType,
      ]);

      res
        .status(200)
        .json({ message: "News status and note updated successfully" });
    } catch (error) {
      console.error("Failed to update news status and note:", error);
      res
        .status(500)
        .json({ message: "Failed to update news status and note" });
    }
  }
);
app.put("/update-news/:newsId", authenticateToken, async (req, res) => {
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
      SELECT n.news_id, n.title, n.content, nc.name as category_name, n.created_at, n.status, n.note, n.image,
        CASE
          WHEN n.posted_by_type = 'admin' THEN a.name
          WHEN n.posted_by_type = 'business' THEN a.name
          ELSE NULL
        END as profile_name
      FROM news n
      LEFT JOIN newscategories nc ON n.newscategory_id = nc.newscategory_id
      LEFT JOIN admin ad ON n.posted_by_type = 'admin' AND n.posted_by_id_admin = ad.admin_id
      LEFT JOIN business b ON n.posted_by_type = 'business' AND n.posted_by_id_business = b.business_id
      LEFT JOIN accounts a ON (
        (n.posted_by_type = 'admin' AND ad.account_id = a.account_id) OR 
        (n.posted_by_type = 'business' AND b.account_id = a.account_id)
      )
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
app.get("/get-contacts", authenticateToken, async (req, res) => {
  try {
    const query = "SELECT * FROM contacts";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch contacts:", error);
    res.status(500).json({ message: "Failed to fetch contacts" });
  }
});
app.get(
  "/get-contacts-business/:accountId",
  authenticateToken,
  async (req, res) => {
    const { accountId } = req.params;
    try {
      const query =
        "SELECT cb.*, t.name FROM contacts_business cb JOIN tours t ON cb.tour_id = t.tour_id  WHERE cb.business_id = $1";
      const result = await pool.query(query, [accountId]);
      res.json(result.rows);
    } catch (error) {
      console.error("Failed to fetch contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  }
);

app.get("/contacts-detail/:contactId", authenticateToken, async (req, res) => {
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
app.get(
  "/contacts-detail-business/:contactId",
  authenticateToken,
  async (req, res) => {
    const { contactId } = req.params;

    try {
      const query =
        "SELECT cb.*, t.name FROM contacts_business cb JOIN tours t ON cb.tour_id = t.tour_id  WHERE cb.contact_id = $1";
      const result = await pool.query(query, [contactId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Failed to fetch contact:", error);
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  }
);

app.post("/send-contact-business/:businessId/:tourId", async (req, res) => {
  const { businessId, tourId } = req.params;
  const { fullname, email, phonenumber, message } = req.body;

  try {
    const newContact = await pool.query(
      "INSERT INTO contacts_business (business_id, tour_id, fullname, email, phonenumber, message, status,senttime) VALUES ($1, $2, $3, $4, $5, $6, 'Pending', NOW()) RETURNING *",
      [businessId, tourId, fullname, email, phonenumber, message]
    );

    res.status(201).json(newContact.rows[0]);
  } catch (error) {
    console.error("Error sending contact:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.put(
  "/update-status-contact/:contactId/:adminId",
  authenticateToken,
  async (req, res) => {
    const { contactId, adminId } = req.params;
    const { status } = req.body;

    try {
      const query = `
      UPDATE contacts 
      SET status = $1
      WHERE contact_id = $2
    `;
      await pool.query(query, [status, contactId]);

      const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
      const action = "Cập nhật trạng thái liên hệ !";
      const actionTime = new Date().toISOString();
      const objectType = "contacts";

      await pool.query(insertAdminActionQuery, [
        adminId,
        contactId,
        action,
        actionTime,
        objectType,
      ]);

      res.status(200).json({ message: "Contact status updated successfully" });
    } catch (error) {
      console.error("Failed to update contact status:", error);
      res.status(500).json({ message: "Failed to update contact status" });
    }
  }
);

app.put(
  "/update-status-contact-business/:contactId",
  authenticateToken,
  async (req, res) => {
    const { contactId } = req.params;
    const { status } = req.body;

    try {
      const query = `
      UPDATE contacts_business 
      SET status = $1
      WHERE contact_id = $2
    `;
      await pool.query(query, [status, contactId]);

      res.status(200).json({ message: "News status updated successfully" });
    } catch (error) {
      console.error("Failed to update news status:", error);
      res.status(500).json({ message: "Failed to update news status " });
    }
  }
);
app.get("/locations", async (req, res) => {
  const { location_type } = req.query;
  try {
    const query = "SELECT * FROM locations WHERE location_type =$1";
    const result = await pool.query(query, [location_type]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/add-tours/:business_id",
  authenticateToken,
  upload.array("images"),
  async (req, res) => {
    try {
      const business_id = req.params.business_id;
      const {
        name,
        description,
        adult_price,
        child_price,
        infant_price,
        start_date,
        end_date,
        quantity,
        vehicle,
        hotel,
        tourcategory_id,
        location_departure_id,
        destination_locations,
      } = req.body;

      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one image is required." });
      }

      const newTour = await pool.query(
        `INSERT INTO tours (name, description, adult_price, child_price, infant_price, start_date, end_date, quantity, status, vehicle, hotel, tourcategory_id, business_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9, $10, $11, $12, NOW())
            RETURNING tour_id`,
        [
          name,
          description,
          adult_price,
          child_price,
          infant_price,
          start_date,
          end_date,
          quantity,
          vehicle,
          hotel,
          tourcategory_id,
          business_id,
        ]
      );

      const tour_id = newTour.rows[0].tour_id;

      await pool.query(
        `INSERT INTO departurelocation (location_departure_id, tour_id)
            VALUES ($1, $2)`,
        [location_departure_id, tour_id]
      );

      for (let i = 0; i < destination_locations.length; i++) {
        await pool.query(
          `INSERT INTO destinationlocation (location_destination_id, tour_id)
              VALUES ($1, $2)`,
          [destination_locations[i], tour_id]
        );
      }

      const images = req.files;
      for (let i = 0; i < images.length; i++) {
        const image = images[i].buffer;
        await pool.query(
          `INSERT INTO tourimages (tour_id, image)
              VALUES ($1, $2)`,
          [tour_id, image]
        );
      }

      res
        .status(201)
        .json({ message: "Tour and images added successfully!", tour_id });
    } catch (error) {
      console.error("Error adding tour: ", error.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);
app.get("/tourcategories", async (req, res) => {
  try {
    const queryText = "SELECT tourcategory_id, name FROM tourcategories";
    const { rows } = await pool.query(queryText);
    res.status(200).json(rows);
  } catch (error) {
    console.error("Error getting tour categories:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

app.get("/list-tours/:business_id", async (req, res) => {
  const { business_id } = req.params;

  const query = `
    SELECT
      t.tour_id,
      t.name AS tour_name,
      t.description,
      t.adult_price,
      t.child_price,
      t.infant_price,
      t.start_date,
      t.end_date,
      t.quantity,
      t.status,
      t.created_at,
      t.vehicle,
      t.hotel,
      dl.location_departure_id,
      tc.name AS tourcategory_name,
      (SELECT ti.image FROM tourimages ti WHERE ti.tour_id = t.tour_id ORDER BY ti.id ASC LIMIT 1) AS image,
      array_agg(dsl.location_destination_id) AS destination_locations
    FROM
      tours t
    LEFT JOIN
      departurelocation dl ON t.tour_id = dl.tour_id
    LEFT JOIN
      destinationlocation dsl ON t.tour_id = dsl.tour_id
    LEFT JOIN
      tourcategories tc ON t.tourcategory_id = tc.tourcategory_id
    WHERE
      t.business_id = $1
    GROUP BY
      t.tour_id, dl.location_departure_id, tc.name
  `;

  try {
    const result = await pool.query(query, [business_id]);

    const tours = result.rows.map((row) => ({
      ...row,
      image: row.image ? row.image.toString("base64") : null,
    }));

    res.json(tours);
  } catch (error) {
    console.error("Error executing query", error.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/list-tours-filter", async (req, res) => {
  const {
    location_departure_id,
    location_destination_id,
    tourcategory_name,
    name,
    min_adult_price,
    max_adult_price,
    hotel,
    vehicle,
    start_date,
  } = req.query;
  if (!tourcategory_name) {
    return res.status(400).json({ error: "tourcategory_name is required" });
  }

  let query = `
    SELECT
      t.tour_id,
      t.name AS tour_name,
      t.description,
      t.adult_price,
      t.child_price,
      t.infant_price,
      t.start_date,
      t.end_date,
      t.quantity,
      t.status,
      t.created_at,
      t.vehicle,
      t.hotel,
      dl.location_departure_id,
       array_agg(dsl.location_destination_id) AS destination_locations,
      ldep.location_name as departure_location_name,
      array_agg(ldes.location_name) as destination_location_name,
      tc.name AS tourcategory_name,
      (SELECT ti.image FROM tourimages ti WHERE ti.tour_id = t.tour_id ORDER BY ti.id ASC LIMIT 1) AS image
     
    FROM
      tours t
    LEFT JOIN
      departurelocation dl ON t.tour_id = dl.tour_id
    LEFT JOIN
      locations ldep ON dl.location_departure_id = ldep.location_id
    LEFT JOIN
      destinationlocation dsl ON t.tour_id = dsl.tour_id
     LEFT JOIN
      locations ldes ON dsl.location_destination_id = ldes.location_id
    LEFT JOIN
      tourcategories tc ON t.tourcategory_id = tc.tourcategory_id
    LEFT JOIN
      business b ON t.business_id = b.business_id
    LEFT JOIN 
      accounts a ON b.account_id = a.account_id
    WHERE
      t.status = 'Active' AND tc.name = $1 AND a.status = 'Active'
  `;

  const params = [tourcategory_name];

  if (location_departure_id) {
    query += ` AND dl.location_departure_id = $${params.length + 1}`;
    params.push(location_departure_id);
  }

  if (location_destination_id) {
    query += ` AND dsl.location_destination_id = $${params.length + 1}`;
    params.push(location_destination_id);
  }

  if (name) {
    query += ` AND unaccent(LOWER(t.name)) LIKE unaccent(LOWER($${
      params.length + 1
    }))`;
    params.push(`%${name}%`);
  }

  if (min_adult_price && max_adult_price) {
    query += ` AND t.adult_price BETWEEN $${params.length + 1} AND $${
      params.length + 2
    }`;
    params.push(min_adult_price);
    params.push(max_adult_price);
  } else if (min_adult_price) {
    query += ` AND t.adult_price >= $${params.length + 1}`;
    params.push(min_adult_price);
  } else if (max_adult_price) {
    query += ` AND t.adult_price <= $${params.length + 1}`;
    params.push(max_adult_price);
  }

  if (hotel) {
    query += ` AND t.hotel = $${params.length + 1}`;
    params.push(hotel);
  }
  if (vehicle) {
    query += ` AND t.vehicle = $${params.length + 1}`;
    params.push(vehicle);
  }

  if (start_date) {
    query += ` AND t.start_date >= $${params.length + 1}`;
    params.push(start_date);
  }

  query += `
    GROUP BY
      t.tour_id, departure_location_name, dl.location_departure_id, tc.name
  `;

  try {
    const result = await pool.query(query, params);

    const tours = result.rows.map((row) => ({
      ...row,
      image: row.image ? row.image.toString("base64") : null,
    }));

    res.json(tours);
  } catch (error) {
    console.error("Error executing query", error.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-tour/:tourId", async (req, res) => {
  try {
    const tourId = req.params.tourId;

    const tourQuery = await pool.query(
      `SELECT t.*, a.name as account_name, dl.location_departure_id , array_agg(ldes.location_name) as destination_location_name, ldep.location_name as departure_location_name, array_agg(dst.location_destination_id) as destination_locations
      FROM tours t
         LEFT JOIN
      business b ON t.business_id = b.business_id
    LEFT JOIN 
      accounts a ON b.account_id = a.account_id
      LEFT JOIN departurelocation dl ON t.tour_id = dl.tour_id
       LEFT JOIN
      locations ldep ON dl.location_departure_id = ldep.location_id
      LEFT JOIN destinationlocation dst ON t.tour_id = dst.tour_id
      LEFT JOIN
      locations ldes ON dst.location_destination_id = ldes.location_id
      WHERE t.tour_id = $1
      GROUP BY t.tour_id, a.name, departure_location_name, dl.location_departure_id`,
      [tourId]
    );

    if (tourQuery.rows.length === 0) {
      return res.status(404).json({ error: "Tour not found" });
    }

    const tour = tourQuery.rows[0];

    res.status(200).json(tour);
  } catch (error) {
    console.error("Error fetching tour:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

const updateTourStatuses = async () => {
  try {
    const currentDate = new Date();

    const updateQuery = `
      UPDATE tours
      SET status = 'Inactive'
      WHERE start_date < $1
    `;

    await pool.query(updateQuery, [currentDate]);

    console.log("Tour statuses updated successfully");
  } catch (error) {
    console.error("Error updating tour statuses:", error.message);
  }
};

cron.schedule("0 0 * * *", updateTourStatuses);

app.put(
  "/update-tour/:tour_id",
  authenticateToken,
  upload.array("images"),
  async (req, res) => {
    try {
      const tour_id = req.params.tour_id;
      const {
        name,
        description,
        adult_price,
        child_price,
        infant_price,
        start_date,
        end_date,
        quantity,
        vehicle,
        hotel,
        tourcategory_id,
        location_departure_id,
        destination_locations,
      } = req.body;

      const existingTour = await pool.query(
        `SELECT * FROM tours WHERE tour_id = $1`,
        [tour_id]
      );

      if (existingTour.rows.length === 0) {
        return res.status(404).json({ error: "Tour not found" });
      }

      await pool.query(
        `UPDATE tours
        SET name = $1,
            description = $2,
            adult_price = $3,
            child_price = $4,
            infant_price = $5,
            start_date = $6,
            end_date = $7,
            quantity = $8,
            vehicle = $9,
            hotel = $10,
            tourcategory_id = $11,
            created_at = NOW(),
            status= 'Active'
        WHERE tour_id = $12`,
        [
          name,
          description,
          adult_price,
          child_price,
          infant_price,
          start_date,
          end_date,
          quantity,
          vehicle,
          hotel,
          tourcategory_id,
          tour_id,
        ]
      );

      await pool.query(
        `UPDATE departurelocation
        SET location_departure_id = $1
        WHERE tour_id = $2`,
        [location_departure_id, tour_id]
      );

      await pool.query(`DELETE FROM destinationlocation WHERE tour_id = $1`, [
        tour_id,
      ]);

      for (let i = 0; i < destination_locations.length; i++) {
        await pool.query(
          `INSERT INTO destinationlocation (location_destination_id, tour_id)
              VALUES ($1, $2)`,
          [destination_locations[i], tour_id]
        );
      }

      res.status(200).json({ message: "Tour updated successfully!" });
    } catch (error) {
      console.error("Error updating tour: ", error.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

app.get("/get-all-tour-images/:tourId", async (req, res) => {
  try {
    const tourId = req.params.tourId;
    const imageQuery = await pool.query(
      `SELECT image FROM tourimages WHERE tour_id = $1`,
      [tourId]
    );

    if (imageQuery.rows.length === 0) {
      return res.status(404).json({ error: "Images not found for this tour" });
    }

    const imagesBase64 = [];

    for (let i = 0; i < imageQuery.rows.length; i++) {
      const imageData = imageQuery.rows[i].image;
      const base64Image = Buffer.from(imageData, "binary").toString("base64");
      imagesBase64.push({ tour_id: tourId, image: base64Image });
    }

    res.status(200).json(imagesBase64);
  } catch (error) {
    console.error("Error fetching tour images:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.put(
  "/update-tour-images/:tour_id",
  authenticateToken,
  upload.array("images"),
  async (req, res) => {
    try {
      const tour_id = req.params.tour_id;

      const existingTour = await pool.query(
        `SELECT * FROM tours WHERE tour_id = $1`,
        [tour_id]
      );

      if (existingTour.rows.length === 0) {
        return res.status(404).json({ error: "Tour not found" });
      }

      if (req.files && req.files.length > 0) {
        await pool.query(`DELETE FROM tourimages WHERE tour_id = $1`, [
          tour_id,
        ]);

        const images = req.files;
        for (let i = 0; i < images.length; i++) {
          const image = images[i].buffer;
          await pool.query(
            `INSERT INTO tourimages (tour_id, image)
              VALUES ($1, $2)`,
            [tour_id, image]
          );
        }
      }

      res.status(200).json({ message: "Tour images updated successfully!" });
    } catch (error) {
      console.error("Error updating tour images: ", error.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

app.post("/add-policies/:business_id", authenticateToken, async (req, res) => {
  const businessId = req.params.business_id;
  const { policytype, description } = req.body;

  if (!policytype || !description) {
    return res
      .status(400)
      .json({ error: "Please provide policytype and description" });
  }

  try {
    const insertQuery = `
      INSERT INTO policies (business_id, policytype, description)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const newPolicy = await pool.query(insertQuery, [
      businessId,
      policytype,
      description,
    ]);

    res.status(201).json(newPolicy.rows[0]);
  } catch (error) {
    console.error("Error adding policy:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/add-policy-cancellation/:businessId", async (req, res) => {
  const { days_before_departure, refund_percentage } = req.body;
  const { businessId } = req.params;

  if (days_before_departure == null || refund_percentage == null) {
    return res.status(400).json({
      error: "Both days_before_departure and refund_percentage are required",
    });
  }

  try {
    const result = await pool.query(
      "INSERT INTO policy_cancellation (days_before_departure, refund_percentage, business_id) VALUES ($1, $2, $3) RETURNING *",
      [days_before_departure, refund_percentage, businessId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error inserting policy cancellation:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/list-policies/:business_id", async (req, res) => {
  const { business_id } = req.params;

  try {
    let query = `SELECT * FROM policies WHERE business_id = $1`;
    
    const result = await pool.query(query, [business_id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching policies:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/list-policies-cancellation/:business_id", async (req, res) => {
  const { business_id } = req.params;

  try {
    let query = `SELECT * FROM policy_cancellation WHERE business_id = $1`;
    
    const result = await pool.query(query, [business_id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching policies:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/delete-policy/:policyId", authenticateToken, async (req, res) => {
  const { policyId } = req.params;
  const role = req.query.role;

  try {
    let query = "";
    if (role === "3") {
      query = `DELETE FROM policies WHERE policy_id = $1`;
    } else {
      query = `DELETE FROM policy_cancellation WHERE policy_id = $1`;
    }

    await pool.query(query, [policyId]);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete policy:", error);
    res.status(500).json({ message: "Failed to delete policy" });
  }
});
app.get("/policies/:policy_id", async (req, res) => {
  const { policy_id } = req.params;
  const role = req.query.role;

  try {
    let query = "";
    if (role === "3") {
      query = `SELECT * FROM policies WHERE policy_id = $1`;
    } else {
      query = `SELECT * FROM policy_cancellation WHERE policy_id = $1`;
    }
    const policiesResult = await pool.query(query, [policy_id]);

    if (policiesResult.rows.length === 0) {
      return res.status(404).json({ error: "Policy not found" });
    }

    const policy = policiesResult.rows[0];
    res.json(policy);
  } catch (error) {
    console.error("Error fetching policy:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/policies/:policy_id", async (req, res) => {
  const { policy_id } = req.params;
  const role = req.query.role;
  const { policytype, description, days_before_departure, refund_percentage } =
    req.body;

  try {
    let query = "";
    if (role === "3") {
      query = `UPDATE policies SET policytype = $1, description = $2 WHERE policy_id = $3 RETURNING *`;
      var policiesUpdate = await pool.query(query, [
        policytype,
        description,
        policy_id,
      ]);
    } else {
      query = `UPDATE policy_cancellation SET days_before_departure = $1, refund_percentage = $2 WHERE policy_id = $3 RETURNING *`;
      var policiesUpdate = await pool.query(query, [
        days_before_departure,
        refund_percentage,
        policy_id,
      ]);
    }

    if (policiesUpdate.rows.length === 0) {
      return res.status(404).json({ error: "Policy not found" });
    }

    const updatedData = policiesUpdate.rows[0];
    const tableName = "policies";

    res.json({ tableName, updatedData });
  } catch (error) {
    console.error("Error updating policy:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/tours-rating/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;

    const query = `
      SELECT 
        t.tour_id, 
        t.name AS tour_name, 
        COALESCE(AVG(r.rating), 0) AS average_rating, 
        COUNT(r.rating_id) AS total_ratings,
         (SELECT ti.image FROM tourimages ti WHERE ti.tour_id = t.tour_id ORDER BY ti.id ASC LIMIT 1) AS image
      FROM 
        tours t
      LEFT JOIN 
        Ratings r ON t.tour_id = r.tour_id
      WHERE 
        t.business_id = $1
      GROUP BY 
        t.tour_id, t.name
      ORDER BY 
        t.tour_id;
    `;

    const result = await pool.query(query, [businessId]);
    const tours = result.rows.map((row) => ({
      ...row,
      image: row.image ? row.image.toString("base64") : null,
    }));

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No tours found for this account." });
    }
    res.json(tours);
  } catch (error) {
    console.error("Error fetching tours:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-ratings-tour/:tour_id", async (req, res) => {
  const { tour_id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT a.name, r.rating, r.review, r.date_rating
      FROM ratings r
      LEFT JOIN
      customers c ON r.customer_id = c.customer_id
      LEFT JOIN 
      accounts a ON c.account_id = a.account_id
      WHERE r.tour_id = $1
    `,
      [tour_id]
    );

    const averageRating = await pool.query(
      `
      SELECT AVG(rating) as avg_rating, COUNT(*) as total_ratings
      FROM ratings
      WHERE tour_id = $1
    `,
      [tour_id]
    );

    res.json({
      reviews: result.rows,
      averageRating: parseFloat(averageRating.rows[0].avg_rating).toFixed(2),
      totalRatings: parseInt(averageRating.rows[0].total_ratings, 10),
    });
  } catch (error) {
    console.error("Error fetching ratings:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/report-tour/:tourId/:customerId", async (req, res) => {
  const { tourId, customerId } = req.params;
  const { type_report, description } = req.body;

  try {
     
    
    const query = `
      INSERT INTO tour_reports (tour_id, customer_id, reportdate, type_report, description, status)
      VALUES ($1, $2, NOW(), $3, $4, 'Pending')
    `;
    const values = [tourId, customerId, type_report, description];
    const result = await pool.query(query, values);

    res.status(200).json({ message: "Report tour successful" });
  } catch (error) {
    console.error("Error reporting tour:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/report-list", async (req, res) => {
  try {
    const reportQuery = await pool.query(`
      SELECT 
        tr.report_id, 
        t.name AS tour_name, 
        a.name AS account_name, 
        tr.type_report, 
        tr.reportdate, 
        tr.status
      FROM 
        tour_reports tr
      JOIN 
        tours t ON tr.tour_id = t.tour_id
           LEFT JOIN
      customers c ON tr.customer_id = c.customer_id
    LEFT JOIN 
      accounts a ON c.account_id = a.account_id
      
    `);

    if (reportQuery.rows.length === 0) {
      return res.status(404).json({ error: "No reports found" });
    }

    res.status(200).json(reportQuery.rows);
  } catch (error) {
    console.error("Error fetching reports:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/report-details/:reportId", async (req, res) => {
  try {
    const reportId = req.params.reportId;
    const reportQuery = await pool.query(
      `SELECT 
                tr.report_id, 
                t.name AS tour_name, 
                a.name AS account_name, 
                a.phone_number, 
                tr.type_report, 
                tr.description, 
                tr.reportdate, 
                tr.status, 
                a2.name AS nameaccounttour
            FROM 
                tour_reports tr
            LEFT JOIN 
                tours t ON tr.tour_id = t.tour_id
            LEFT JOIN
                customers c ON tr.customer_id = c.customer_id
            LEFT JOIN 
                accounts a ON c.account_id = a.account_id
            LEFT JOIN
                business b ON t.business_id = b.business_id
            LEFT JOIN 
                accounts a2 ON b.account_id = a2.account_id
            WHERE 
                tr.report_id = $1
            ORDER BY 
                tr.reportdate DESC;`,
      [reportId]
    );

    if (reportQuery.rows.length === 0) {
      return res.status(404).json({ error: "Report not found" });
    }

    const report = reportQuery.rows[0];
    res.status(200).json(report);
  } catch (error) {
    console.error("Error fetching report details:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put(
  "/update-status-report/:reportId/:adminId",
  authenticateToken,
  async (req, res) => {
    const { reportId, adminId } = req.params;
    const { status } = req.body;

    try {
      const query = `
      UPDATE tour_reports 
      SET status = $1
      WHERE report_id = $2
    `;
      await pool.query(query, [status, reportId]);

      const insertAdminActionQuery = `
      INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type) 
      VALUES ($1, $2, $3, $4, $5)
    `;
      const action = 'Cập nhật trạng thái báo cáo tour !';
      const actionTime = new Date().toISOString();
      const objectType = 'tour_reports';

      await pool.query(insertAdminActionQuery, [
        adminId,
        reportId,
        action,
        actionTime,
        objectType,
      ]);

      res.status(200).json({ message: "Report status updated successfully" });
    } catch (error) {
      console.error("Failed to update Report status :", error);
      res.status(500).json({ message: "Failed to update Report status " });
    }
  }
);

const getPendingCount = async (table, status, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      `SELECT COUNT(*) FROM ${table} WHERE status = $1`,
      [status]
    );
    const count = result.rows[0].count;
    client.release();
    res.json({ count });
  } catch (error) {
    console.error(`Error executing query for table ${table}:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
app.get("/pending-count-status-contact", (req, res) => {
  getPendingCount("contacts", "Pending", res);
});

app.get("/pending-count-status-report", (req, res) => {
  getPendingCount("tour_reports", "Pending", res);
});

app.get("/pending-count-status-news", (req, res) => {
  getPendingCount("news", "Pending", res);
});
app.get("/pending-count-status-tour", (req, res) => {
  getPendingCount("tours", "Inactive", res);
});
app.get("/pending-count-status-contact-business", (req, res) => {
  getPendingCount("contacts_business", "Pending", res);
});

app.get("/coupons/:customerId", async (req, res) => {
  const customerId = req.params.customerId;

  try {
    const couponsQuery = `
            SELECT *
            FROM coupons
            WHERE customer_id = $1
            ORDER BY created_at DESC
        `;

    const totalPointsQuery = `
            SELECT SUM(points) AS total_used_points
            FROM coupons
            WHERE customer_id = $1 AND is_used = 'Unused'
        `;

    const couponsResult = await pool.query(couponsQuery, [customerId]);
    const totalPointsResult = await pool.query(totalPointsQuery, [customerId]);

    const coupons = couponsResult.rows;
    const totalUsedPoints = totalPointsResult.rows[0].total_used_points || 0;

    res.json({
      coupons: coupons,
      totalUsedPoints: totalUsedPoints,
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/daily-checkin/:customerId", async (req, res) => {
  const customerId = req.params.customerId;
  const currentDate = moment().tz("Asia/Ho_Chi_Minh").format("YYYY-MM-DD");

  try {
    const checkinQuery = `
      SELECT * FROM daily_checkin 
      WHERE customer_id = $1 AND checkindate = $2
    `;
    const checkinResult = await pool.query(checkinQuery, [
      customerId,
      currentDate,
    ]);

    if (checkinResult.rows.length > 0) {
      return res
        .status(400)
        .json({
          message: "Bạn đã điểm danh hôm nay. Vui lòng quay lại ngày sau !",
        });
    }

    const insertCheckinQuery = `
      INSERT INTO daily_checkin (customer_id, checkindate) 
      VALUES ($1, $2)
    `;
    await pool.query(insertCheckinQuery, [customerId, currentDate]);

    const insertCouponQuery = `
      INSERT INTO coupons (customer_id, points, description, created_at, expires_at, is_used) 
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const points = 1000;
    const description = "Điểm danh hằng ngày";
    const createAt = new Date().toISOString();
    const expiresAt = new Date(
      new Date().setDate(new Date().getDate() + 30)
    ).toISOString();
    const isUsed = "Unused";

    await pool.query(insertCouponQuery, [
      customerId,
      points,
      description,
      currentDate,
      expiresAt,
      isUsed,
    ]);

    res
      .status(200)
      .json({ message: "Điểm danh thành công và đã nhận được Xu" });
  } catch (error) {
    console.error("Error during daily check-in:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------------------------------
module.exports = app;
