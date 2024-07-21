const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const moment = require("moment-timezone");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const { generateRandomCode } = require("../middlewares/randomcode.js");
const { transporter } = require("../middlewares/nodemail.js");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const currentDateTime = moment()
  .tz("Asia/Ho_Chi_Minh")
  .format("YYYY-MM-DD HH:mm:ss");
const formatDate = (
  date,
  timezone = "Asia/Ho_Chi_Minh",
  format = "DD-MM-YYYY HH:mm:ss"
) => {
  return moment(date).tz(timezone).format(format);
};
const formatDate1 = (
  date,
  timezone = "Asia/Ho_Chi_Minh",
  format = "DD-MM-YYYY"
) => {
  return moment(date).tz(timezone).format(format);
};
const formatPrice = (price) => {
  if (typeof price !== "number") {
    return price;
  }
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(price);
};
app.use(bodyParser.json());

pool.connect((err) => {
  if (err) {
    console.error("Admin Postgres connection error:", err);
  } else {
    console.log("Admin Connected to Postgres");
  }
});

//-----------------------------------------------
function validateRegister(data) {
  const errors = [];

  if (!data.username) {
    errors.push("Tên đăng nhập là bắt buộc.");
  } else if (typeof data.username !== "string" || data.username.trim() === "") {
    errors.push("Tên đăng nhập không hợp lệ.");
  } else if (data.username.length < 3) {
    errors.push("Tên đăng nhập phải có ít nhất 3 ký tự.");
  } else if (/\s/.test(data.username)) {
    errors.push("Username không được chứa dấu cách.");
  }

  if (!data.password) {
    errors.push("Mật khẩu là bắt buộc.");
  } else if (typeof data.password !== "string" || data.password.length < 8) {
    errors.push("Mật khẩu phải có ít nhất 8 ký tự.");
  } else if (/\s/.test(data.password)) {
    errors.push("Mật khẩu không được chứa dấu cách.");
  }
  // else if (!/[A-Z]/.test(data.password)) {
  //   errors.push("Mật khẩu phải chứa ít nhất một chữ cái viết hoa.");
  // } else if (!/[a-z]/.test(data.password)) {
  //   errors.push("Mật khẩu phải chứa ít nhất một chữ cái viết thường.");
  // } else if (!/[0-9]/.test(data.password)) {
  //   errors.push("Mật khẩu phải chứa ít nhất một chữ số.");
  // } else if (!/[!@#$%^&*]/.test(data.password)) {
  //   errors.push("Mật khẩu phải chứa ít nhất một ký tự đặc biệt (!@#$%^&*).");
  // }

  if (!data.email) {
    errors.push("Email là bắt buộc.");
  } else if (typeof data.email !== "string" || data.email.trim() === "") {
    errors.push("Email không hợp lệ.");
  } else if (
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(data.email)
  ) {
    errors.push("Email không đúng định dạng.");
  }

  if (!data.name) {
    errors.push("Tên là bắt buộc.");
  } else if (typeof data.name !== "string" || data.name.trim() === "") {
    errors.push("Tên không hợp lệ.");
  } else if (/[!@#$%^&*]/.test(data.name)) {
    errors.push("Tên không được chứa ký tự đặc biệt !.");
  }
  
    if (!data.birth_of_date) {
      errors.push("Ngày sinh là bắt buộc.");
    } else if (isNaN(Date.parse(data.birth_of_date))) {
      errors.push("Ngày sinh không hợp lệ.");
    }

  // Validate phone_number
  if (!data.phone_number) {
    errors.push("Số điện thoại là bắt buộc.");
  } else if (!/^\d{10}$/.test(data.phone_number)) {
    errors.push("Số điện thoại phải có 10 chữ số.");
  }

  // Validate address
  if (!data.address) {
    errors.push("Địa chỉ là bắt buộc.");
  } else if (typeof data.address !== "string" || data.address.trim() === "") {
    errors.push("Địa chỉ không hợp lệ.");
  }

  return errors;
}
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
     const errors = validateRegister(req.body);
     if (errors.length > 0) {
       return res.status(400).json({ errors });
     }

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
      return res.status(400).json({
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
      from: "Tour Travel <your-email@gmail.com>",
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

//-----------------------------------------------
app.put(
  "/update-status-accounts/:accountId/:adminId",
  authenticateToken,
  async (req, res) => {
    const { accountId, adminId } = req.params;
    const { status, note } = req.body;

    try {
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

      res.status(200).json({
        message: "Cập nhật tài khoản thành công !",
      });
    } catch (error) {
      console.error("Lỗi khi cập nhật tài khoản:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

//-----------------------------------------------

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

//-----------------------------------------------

app.get("/get-admins", authenticateToken, async (req, res) => {
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

//-----------------------------------------------
function validateNews(data) {
  const errors = [];

  if (
    !data.title ||
    typeof data.title !== "string" ||
    data.title.trim() === ""
  ) {
    errors.push("Tiêu đề không được để trống và phải là chuỗi văn bản.");
  } 
  // else if (data.title.length > 100) {
  //   errors.push("Tiêu đề không được vượt quá 100 ký tự.");
  // } 
  else if (/[^a-zA-Z0-9\s\p{P}]/u.test(data.title)) {
    errors.push(
      "Tiêu đề chỉ được chứa chữ cái, số, khoảng trắng và ký tự đặc biệt hợp lệ."
    );
  }

  if (
    !data.content ||
    typeof data.content !== "string" ||
    data.content.trim() === ""
  ) {
    errors.push("Nội dung không được để trống và phải là chuỗi văn bản.");
  } 
  // else if (data.content.length > 2000) {
  //   errors.push("Nội dung không được vượt quá 2000 ký tự.");
  // }

  
   if (req.file && !["image/jpeg", "image/png"].includes(req.file.mimetype)) {
     errors.push("Ảnh phải là định dạng JPEG hoặc PNG.");
   }

  return errors;
}

app.post(
  "/add-news/:account_id/:adminId?",
  authenticateToken,
  upload.single("image"),
  async (req, res) => {
    const accountId = req.params.account_id;
    const adminId = req.params.adminId;
    const { title, content, newscategory_id } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    try {
          const errors = validateNews(req.body);
          if (errors.length > 0) {
            return res.status(400).json({ errors });
          }
      let query = "";
      if (req.query.role === "3") {
        query = `
          INSERT INTO news (title, content, newscategory_id, posted_by_id_business, created_at, status, posted_by_type)
          VALUES ($1, $2, $3, $4, $5, 'Pending', 'business')
          RETURNING news_id`;
      } else {
        query = `
          INSERT INTO news (title, content, newscategory_id, posted_by_id_admin, created_at, status, posted_by_type)
          VALUES ($1, $2, $3, $4, $5, 'Confirm', 'admin')
          RETURNING news_id`;
      }

      const newsInsertValues = [
        title,
        content,
        newscategory_id,
        accountId,
        currentDateTime,
      ];
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

      if (adminId) {
        const adminActionQuery = `
        INSERT INTO admin_actions (admin_id, object_id, action, action_time, object_type)
        VALUES ($1, $2, $3, $4, $5)
      `;
        await pool.query(adminActionQuery, [
          adminId,
          newsId,
          "Thêm bài đăng tin tức !",
          currentDateTime,
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

//-----------------------------------------------

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

//-----------------------------------------------

app.delete(
  "/delete-news/:newsId/:adminId?",
  authenticateToken,
  async (req, res) => {
    const { newsId, adminId } = req.params;

    try {
      const deleteQuery = "DELETE FROM news WHERE news_id = $1";
      await pool.query(deleteQuery, [newsId]);

      if (adminId) {
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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------
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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

cron.schedule("0 * * * *", updateTourStatuses);

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
      ORDER BY 
                tr.reportdate DESC
      
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
      const action = "Cập nhật trạng thái báo cáo tour !";
      const actionTime = new Date().toISOString();
      const objectType = "tour_reports";

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
    const result = await pool.query(
      `SELECT COUNT(*) FROM ${table} WHERE status = $1`,
      [status]
    );
    const count = result.rows[0].count;
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
app.get("/pending-count-status-refunds", (req, res) => {
  getPendingCount("refunds", "Pending", res);
});
const getPendingCountBusiness = async (table, status, business_id, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM ${table} WHERE status = $1 AND business_id= $2`,
      [status, business_id]
    );
    const count = result.rows[0].count;
    res.json({ count });
  } catch (error) {
    console.error(`Error executing query for table ${table}:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
app.get("/pending-count-status-tour/:business_id", (req, res) => {
  const business_id = req.params.business_id;

  getPendingCountBusiness("tours", "Inactive", business_id, res);
});
app.get("/pending-count-status-contact-business/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  getPendingCountBusiness("contacts_business", "Pending", business_id, res);
});
app.get("/pending-count-status-orders/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  getPendingCountBusiness("orders", "Pending", business_id, res);
});
app.get("/pending-count-status-request-cancel/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  getPendingCountBusiness("cancellation_request", "Pending", business_id, res);
});
const CountBusiness = async (table, business_id, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM ${table} WHERE  business_id= $1`,
      [business_id]
    );
    const count = result.rows[0].count;
    res.json({ count });
  } catch (error) {
    console.error(`Error executing query for table ${table}:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

app.get("/count-tour-business/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  CountBusiness("tours", business_id, res);
});

app.get("/count-booking-business/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  CountBusiness("orders", business_id, res);
});

const CountNews = async (table, business_id, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM ${table} WHERE  posted_by_id_business = $1 AND posted_by_type='business'`,
      [business_id]
    );
    const count = result.rows[0].count;
    res.json({ count });
  } catch (error) {
    console.error(`Error executing query for table ${table}:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

app.get("/count-news-business/:business_id", (req, res) => {
  const business_id = req.params.business_id;
  CountNews("news", business_id, res);
});
const CountAdmin = async (table, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM ${table} `,
    );
    const count = result.rows[0].count;
    res.json({ count });
  } catch (error) {
    console.error(`Error executing query for table ${table}:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }};

  app.get("/count-customers", (req, res) => {
    CountAdmin("customers", res);
  });
   app.get("/count-business", (req, res) => {
     CountAdmin("business", res);
   });
    app.get("/count-admin", (req, res) => {
      CountAdmin("admin", res);
    });
    const CountAdminCondition = async (table, status, res) => {
      try {
        const result = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE status = $1`, [status]);
        const count = result.rows[0].count;
        res.json({ count });
      } catch (error) {
        console.error(`Error executing query for table ${table}:`, error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    };
      app.get("/count-tours-active", (req, res) => {
        CountAdminCondition("tours", "Active", res);
      });

app.get("/average-rating/:businessId", async (req, res) => {
  const { businessId } = req.params;

  try {
    const averageRatingQuery = `
      SELECT 
        ROUND(AVG(r.rating), 2) AS average_rating
      FROM tours t
      JOIN ratings r ON t.tour_id = r.tour_id
      WHERE t.business_id = $1
    `;

    const averageRatingResult = await pool.query(averageRatingQuery, [
      businessId,
    ]);

    if (averageRatingResult.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy đánh giá cho các tour của doanh nghiệp này.",
      });
    }

    const averageRating = averageRatingResult.rows[0].average_rating;
    if (averageRatingResult.rows[0].average_rating === null) {
      return res.status(404).json({
        message: "Chưa có đánh giá.",
      });
    }

    res.status(200).json({ count: averageRating });
  } catch (error) {
    console.error("Lỗi khi tính điểm đánh giá trung bình:", error);
    res.status(500).json({
      message: "Lỗi khi tính điểm đánh giá trung bình. Vui lòng thử lại sau.",
    });
  }
});

app.get("/list-admin-actions", async (req, res) => {
  try {
    const query = `
      SELECT 
        a.name AS admin_name,
        aa.object_id,
        aa.admin_action_id,
        CASE
        WHEN aa.object_type = 'news' THEN n.title
        WHEN aa.object_type = 'accounts' THEN ac.name         
        ELSE NULL
        END AS object_name,
        aa.action,
        aa.action_time
      FROM 
        admin_actions aa
      JOIN 
        admin ad ON aa.admin_id = ad.admin_id
      JOIN 
        accounts a ON ad.account_id = a.account_id
      LEFT JOIN 
        accounts ac ON aa.object_type = 'accounts' AND aa.object_id = ac.account_id
      LEFT JOIN 
        news n ON aa.object_type = 'news' AND aa.object_id = n.news_id
      ORDER BY 
        aa.action_time DESC
    `;

    const result = await pool.query(query);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Failed to retrieve admin actions:", error);
    res.status(500).json({ message: "Failed to retrieve admin actions" });
  }
});

app.get("/list-orders/:status", authenticateToken, async (req, res) => {
  const { status } = req.params;
  try {
    const ordersQuery = `
      SELECT 
        o.order_id,
        o.tour_id,
        t.name AS tour_name,
        o.adult_quantity,
        o.child_quantity,
        o.infant_quantity,
        o.total_price,
        o.status_payment,
        o.booking_date_time,
        o.note,
        o.customer_id,
        o.business_id,
        o.code_order,
        o.status,
        o.status_rating,
        a.name AS customer_name
      FROM orders o
      JOIN tours t ON o.tour_id = t.tour_id
      JOIN customers c ON o.customer_id = c.customer_id
      JOIN accounts a ON c.account_id = a.account_id
      WHERE o.status_payment = $1
      ORDER BY o.booking_date_time DESC
    `;

    const ordersResult = await pool.query(ordersQuery, [status]);

    if (ordersResult.rows.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    res.status(200).json(ordersResult.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách đơn hàng:", error);
    res.status(500).json({ message: "Lỗi khi lấy danh sách đơn hàng" });
  }
});

cron.schedule("0 * * * *", async () => {
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  const past24Hours = moment()
    .tz("Asia/Ho_Chi_Minh")
    .subtract(24, "hours")
    .format("YYYY-MM-DD HH:mm:ss");

  const cancelOrderQuery = `
    UPDATE orders
    SET status = 'Cancel'
    WHERE status_payment != 'Paid' AND booking_date_time <= $1 AND status != 'Cancel'
  `;

  try {
    await pool.query(cancelOrderQuery, [past24Hours]);
    console.log(
      `Orders updated to 'Cancel' status if not paid within 24 hours as of ${currentDateTime}`
    );
  } catch (error) {
    console.error("Failed to cancel unpaid orders:", error);
  }
});

app.put(
  "/update-status-payment-orders/:orderId",
  authenticateToken,
  async (req, res) => {
    const { orderId } = req.params;
    const { statuspayments } = req.body;

    try {
      const orderDetailQuery = `
        SELECT 
          o.order_id,
          o.tour_id,
          t.name AS tour_name,
          t.start_date,
          o.adult_quantity,
          o.child_quantity,
          o.infant_quantity,
          o.total_price,
          o.status_payment,
          o.booking_date_time,
          o.note,
          o.customer_id,
          c.account_id,
          a.name AS customer_name,
          a.phone_number,
          a.email,
          a.address,
          o.business_id,
          o.code_order,
          o.status,
          o.status_rating,
          l.location_name
        FROM orders o
        JOIN tours t ON o.tour_id = t.tour_id
        LEFT JOIN departurelocation dl ON t.tour_id = dl.tour_id
        LEFT JOIN locations l ON dl.location_departure_id = l.location_id
        JOIN customers c ON o.customer_id = c.customer_id
        JOIN accounts a ON c.account_id = a.account_id
        WHERE o.order_id = $1
      `;

      const orderDetailResult = await pool.query(orderDetailQuery, [orderId]);
      if (orderDetailResult.rows.length === 0) {
        return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
      }

      const query = `
        UPDATE orders 
        SET status_payment = $1
        WHERE order_id = $2
      `;
      await pool.query(query, [statuspayments, orderId]);

      const updatedOrderDetailResult = await pool.query(orderDetailQuery, [
        orderId,
      ]);

      const amount = orderDetailResult.rows[0].total_price;

      if (statuspayments === "Paid") {
        const paymentQuery = `
        INSERT INTO payments (
          order_id,
          payment_date,
          amount,
          payment_method,
          payment_status
        ) VALUES (
          $1,
          $2,
          $3,
          'Chuyển khoản ngân hàng',
          'Completed'
        )
      `;

        await pool.query(paymentQuery, [orderId, currentDateTime, amount]);

        const mailOptions = {
          from: "Tour Travel <your-email@gmail.com>",
          to: updatedOrderDetailResult.rows[0].email,
          subject: "Thanh Toán Thành Công",
          html: `
             <h3 style="font-weight: bold; font-size: 1.6rem;">TOUR TRAVEL</h3>
    <div style="background: #84ffff; border: 5px solid #00796b;">
        <p style="text-align: center; padding: 2rem; color: black;">
            Cảm ơn quý khách đã sử dụng dịch vụ của chúng tôi
            <br />
            Booking của quý khách đã được thanh toán thành công !
        </p>
    </div>
    <h4 style="font-size: 1.5rem;">
        Phiếu xác nhận Thanh toán 
        <span style="border: 3px solid red; color: red;">
            ĐÃ THANH TOÁN
        </span>
    </h4>
    <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
        <p>Mã booking: <strong>${
          updatedOrderDetailResult.rows[0].code_order
        }</strong></p>
        <p style="color: red;">Xin quý khách vui lòng nhớ số booking để thuận tiện cho giao dịch sau này.</p>
        <p>Tên Tour: <strong>${
          updatedOrderDetailResult.rows[0].tour_name
        }</strong></p>
        <p>Ngày đi: <strong>${formatDate1(
          updatedOrderDetailResult.rows[0].start_date
        )}</strong></p>
        <p>Điểm khởi hành: <strong>${
          updatedOrderDetailResult.rows[0].location_name
        }</strong></p>
        <p>Số lượng Người lớn: <strong>${
          updatedOrderDetailResult.rows[0].adult_quantity
        }</strong>, Trẻ em: <strong>${
            updatedOrderDetailResult.rows[0].child_quantity
          }</strong>, Trẻ nhỏ: <strong>${
            updatedOrderDetailResult.rows[0].infant_quantity
          }</strong></p>
        <p>
            Tổng tiền: 
            <span style="color: red; font-weight: bold; font-size: 1.3rem;">
                ${formatPrice(updatedOrderDetailResult.rows[0].total_price)}
            </span>
        </p>
        <p>Ngày booking: <strong>${formatDate(
          updatedOrderDetailResult.rows[0].booking_date_time
        )}</strong></p>
        <p>Ghi chú: <strong>${
          updatedOrderDetailResult.rows[0].note
        }</strong></p>
        
    </div>
    <h4 style="font-weight: bold; font-size: 1.6rem;">THÔNG TIN KHÁCH HÀNG</h4>
    <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
        <p>Khách hàng: <strong>${
          updatedOrderDetailResult.rows[0].customer_name
        }</strong></p>
        <p>Email: <strong>${updatedOrderDetailResult.rows[0].email}</strong></p>
        <p>SĐT: <strong>${
          updatedOrderDetailResult.rows[0].phone_number
        }</strong></p>
        <p>Địa chỉ: <strong>${
          updatedOrderDetailResult.rows[0].address
        }</strong></p>
    </div>
          `,
        };

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log("Gửi email không thành công:", error);
          } else {
            console.log("Email xác nhận đã được gửi: " + info.response);
          }
        });
      }

      res.status(200).json({
        message: "Order status updated successfully",
        order: updatedOrderDetailResult.rows[0],
      });
    } catch (error) {
      console.error("Failed to update Order status:", error);
      res.status(500).json({ message: "Failed to update Order status" });
    }
  }
);

// -----------------------------------------------

const updateOrders = async () => {
  try {
    const currentDate = new Date();

    const toursQuery = `
      SELECT tour_id 
      FROM tours 
      WHERE end_date < $1
    `;
    const toursResult = await pool.query(toursQuery, [currentDate]);

    const tourIds = toursResult.rows.map((row) => row.tour_id);

    if (tourIds.length > 0) {
      const updateQuery = `
        UPDATE orders 
        SET status = 'Complete' 
        WHERE tour_id = ANY($1) 
        AND status = 'Confirm' AND status_payment = 'Paid'
      `;
      await pool.query(updateQuery, [tourIds]);
      console.log("Orders updated successfully");
    } else {
      console.log("No tours to update");
    }
  } catch (error) {
    console.error("Error updating orders:", error);
  }
};

cron.schedule("0 * * * *", () => {
  console.log("Running cron job to update complete orders");
  updateOrders();
});

app.get("/list-refunds", authenticateToken, async (req, res) => {
  try {
    const refundsQuery = `
      SELECT 
        r.refund_id,
        r.request_id,
        r.refund_amount,
        r.refund_date,
        r.request_refund_date,
        r.status,
        r.note,
        cr.order_id,
        cr.reason,
        cr.customer_id,
        cr.business_id,
        o.code_order,
        o.status_payment
      FROM refunds r
      JOIN cancellation_request cr ON r.request_id = cr.request_id
      LEFT JOIN orders o ON cr.order_id = o.order_id
      ORDER BY r.request_refund_date DESC 
    `;
    const refundsResult = await pool.query(refundsQuery);

    if (refundsResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy yêu cầu hoàn tiền nào." });
    }

    res.status(200).json(refundsResult.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách yêu cầu hoàn tiền:", error);
    res
      .status(500)
      .json({ message: "Lỗi khi lấy danh sách yêu cầu hoàn tiền." });
  }
});

// -----------------------------------------------

app.get("/refunds-detail/:refundId", authenticateToken, async (req, res) => {
  const { refundId } = req.params;

  try {
    const refundQuery = `
      SELECT 
        r.refund_id,
        r.request_id,
        r.refund_amount,
        r.refund_date,
        r.status,
        r.note,
        cr.order_id,
        cr.request_date,
        cr.reason,
        cr.status AS request_status,
        cr.status_refund,
        o.customer_id,
        o.business_id,
        o.total_price,
        o.tour_id,
        o.code_order,
        o.status_payment,
        c.bank_account_name,
        c.bank_account_number,
        c.bank_name,
        a.email

      FROM refunds r
      JOIN cancellation_request cr ON r.request_id = cr.request_id
      JOIN orders o ON cr.order_id = o.order_id
      JOIN customers c ON o.customer_id = c.customer_id
      JOIN accounts a ON c.account_id = a.account_id
      WHERE r.refund_id = $1
    `;

    const refundResult = await pool.query(refundQuery, [refundId]);

    if (refundResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy thông tin hoàn tiền" });
    }

    res.status(200).json(refundResult.rows[0]);
  } catch (error) {
    console.error("Lỗi khi lấy thông tin hoàn tiền:", error);
    res.status(500).json({
      message: "Lỗi khi lấy thông tin hoàn tiền. Vui lòng thử lại sau.",
    });
  }
});

//-----------------------------------------------

app.put(
  "/update-status-refund/:refundId",
  authenticateToken,
  async (req, res) => {
    const { refundId } = req.params;
    const { status } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    try {
      const query = `
      UPDATE refunds 
      SET status = $1, refund_date=$2
      WHERE refund_id = $3
    `;
      await pool.query(query, [status, currentDateTime, refundId]);
      if (status === "Refunded") {
        const getRequestIdQuery = `
        SELECT request_id, refund_amount FROM refunds WHERE refund_id = $1
      `;
        const requestIdResult = await pool.query(getRequestIdQuery, [refundId]);
        const { request_id, refund_amount } = requestIdResult.rows[0];

        const updateStatusRefundQuery = `
        UPDATE cancellation_request
        SET status_refund = 'Yes'
        WHERE request_id  = $1
      `;
        await pool.query(updateStatusRefundQuery, [request_id]);

        const getOrderIdQuery = `
        SELECT order_id FROM cancellation_request WHERE request_id = $1
      `;
        const orderIdResult = await pool.query(getOrderIdQuery, [request_id]);
        const { order_id } = orderIdResult.rows[0];

        const getTotalPriceQuery = `
        SELECT total_price FROM orders WHERE order_id = $1
      `;
        const totalPriceResult = await pool.query(getTotalPriceQuery, [
          order_id,
        ]);
        const { total_price } = totalPriceResult.rows[0];

        const newTotalPrice = total_price - refund_amount;

        const updateTotalPriceQuery = `
        UPDATE orders
        SET total_price = $1, status= 'Cancel'
        WHERE order_id = $2
      `;
        await pool.query(updateTotalPriceQuery, [newTotalPrice, order_id]);
      }

      res.status(200).json({ message: "Cập nhật trạng thái thành công!" });
    } catch (error) {
      console.error("Failed to update refund status:", error);
      res.status(500).json({ message: "Cập nhật trạng thái thất bại!" });
    }
  }
);

//-----------------------------------------------

const updateOrderStatus = async () => {
  try {
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    const past24Hours = moment()
      .tz("Asia/Ho_Chi_Minh")
      .subtract(48, "hours")
      .format("YYYY-MM-DD HH:mm:ss");

    const pendingOrdersQuery = `
      SELECT * FROM orders 
      WHERE status = 'Pending' 
      AND status_payment = 'Paid' 
      AND booking_date_time <= $1
    `;

    const pendingOrdersResult = await pool.query(pendingOrdersQuery, [
      past24Hours,
    ]);
    const pendingOrders = pendingOrdersResult.rows;

    for (let order of pendingOrders) {
      const { order_id, total_price, customer_id, business_id } = order;

      const updateOrderStatusQuery = `
        UPDATE orders 
        SET status = 'Cancel'
        WHERE order_id = $1
      `;
      await pool.query(updateOrderStatusQuery, [order_id]);

      const createCancellationRequestQuery = `
        INSERT INTO cancellation_request (
          order_id, 
          request_date, 
          reason, 
          status, 
          status_refund, 
          customer_id, 
          business_id
        ) VALUES ($1, $2, 'Doanh nghiệp không hoạt động!', 'Confirm', 'No', $3, $4)
        RETURNING *
      `;
      const cancellationRequestResult = await pool.query(
        createCancellationRequestQuery,
        [order_id, currentDateTime, customer_id, business_id]
      );

      const { request_id } = cancellationRequestResult.rows[0];

      const createRefundQuery = `
        INSERT INTO refunds (request_id, refund_amount, status, note,request_refund_date )
        VALUES ($1, $2, 'Pending', 'Doanh nghiệp không hoạt động!', $3)
        RETURNING *
      `;
      await pool.query(createRefundQuery, [
        request_id,
        total_price,
        currentDateTime,
      ]);
    }
  } catch (error) {
    console.error("Failed to update order status and create refunds:", error);
  }
};

cron.schedule("0 * * * *", () => {
  console.log(
    "Running cron job to update orders pending to cancle within 24 hours"
  );
  updateOrderStatus();
});
// -----------------------------------------------
app.get("/list-total-revenue-business", authenticateToken, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      message: "Vui lòng cung cấp cả ngày bắt đầu và ngày kết thúc.",
    });
  }

  try {
    const totalRevenueQuery = `
      SELECT 
        b.business_id,
        a.name AS business_name,
        SUM(o.total_price) AS total_revenue,
        o.status_payment_business,
        b.account_id
      FROM orders o
      LEFT JOIN business b ON o.business_id = b.business_id
      LEFT JOIN accounts a ON b.account_id = a.account_id
      WHERE o.status_payment = 'Paid'
      AND o.booking_date_time BETWEEN $1 AND $2
      GROUP BY b.business_id, a.name, o.status_payment_business, b.account_id
    `;

    const totalRevenueResult = await pool.query(totalRevenueQuery, [
      startDate,
      endDate,
    ]);

  
    const totalRevenueList = totalRevenueResult.rows.map((row) => {
      const totalRevenue = parseInt(row.total_revenue);
      const serviceFee = totalRevenue * 0.1;
      const netRevenue = totalRevenue - serviceFee;

      return {
        business_id: row.business_id,
        account_id: row.account_id,
        business_name: row.business_name,
        status_payment_business: row.status_payment_business,
        total_revenue: totalRevenue,
        service_fee: serviceFee,
        net_revenue: netRevenue,
      };
    });

    res.status(200).json({ total_revenue: totalRevenueList });
  } catch (error) {
    console.error("Lỗi khi tính tổng doanh thu:", error);
    res.status(500).json({
      message: "Lỗi khi tính tổng doanh thu. Vui lòng thử lại sau.",
    });
  }
});

// -----------------------------------------------
app.get("/revenue-all", authenticateToken, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      message: "Vui lòng cung cấp ngày bắt đầu và ngày kết thúc.",
    });
  }

  try {
    const query = `
      SELECT   COALESCE(SUM(total_price), 0) AS total_revenue
      FROM orders
      WHERE status_payment = 'Paid'
      AND booking_date_time BETWEEN $1 AND $2
    `;

    const result = await pool.query(query, [startDate, endDate]);

    const totalRevenue = result.rows[0].total_revenue || 0;

    res.status(200).json({ totalRevenue });
  } catch (error) {
    console.error("Lỗi khi tính tổng doanh thu:", error);
    res.status(500).json({
      message: "Lỗi khi tính tổng doanh thu. Vui lòng thử lại sau.",
    });
  }
});
// -----------------------------------------------

app.put(
  "/update-payment-status/:businessId",
  authenticateToken,
  async (req, res) => {
    const { businessId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Vui lòng cung cấp cả tháng và năm.",
      });
    }

    try {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = new Date(year, month, 0);
      const endDateString = endDate.toISOString().split("T")[0];

      const updateQuery = `
      UPDATE orders
      SET status_payment_business = 'Paid'
      WHERE business_id = $1 AND status_payment = 'Paid'
      AND booking_date_time BETWEEN $2 AND $3
    `;

      await pool.query(updateQuery, [businessId, startDate, endDateString]);

      res.status(200).json({
        message:
          "Đã cập nhật trạng thái thanh toán của các đơn hàng thành 'Paid'.",
      });
    } catch (error) {
      console.error("Lỗi khi cập nhật trạng thái thanh toán:", error);
      res.status(500).json({
        message:
          "Lỗi khi cập nhật trạng thái thanh toán. Vui lòng thử lại sau.",
      });
    }
  }
);

// -----------------------------------------------

const updatePoints = async () => {
      const currentDateTime = moment()
        .tz("Asia/Ho_Chi_Minh")
        .format("YYYY-MM-DD HH:mm:ss");
  try {
    const selectOrdersQuery = `
      SELECT o.order_id, o.tour_id, o.customer_id, o.business_id, o.share_token, s.customer_id AS shared_by_customer_id
      FROM orders o
      JOIN shared_links s ON o.share_token = s.share_token
      WHERE o.status_add_coupons = 'No'
      AND o.status = 'Confirm'
      AND o.status_payment = 'Paid'
    `;
    const ordersResult = await pool.query(selectOrdersQuery);
    const orders = ordersResult.rows;

    for (const order of orders) {
      const { order_id, business_id, shared_by_customer_id } = order;
      const expiresAt = moment()
        .tz("Asia/Ho_Chi_Minh")
        .add(30, "days")
        .format("YYYY-MM-DD HH:mm:ss");

      const addPointsQuery = `
        INSERT INTO coupons (customer_id, points, description, created_at, expires_at, is_used, business_id)
        VALUES ($1, $2, $3, $4, $5, 'Unused', $6)
      `;
      await pool.query(addPointsQuery, [
        shared_by_customer_id,
        5000, 
        `Chia sẻ tour thành công !`,
        currentDateTime,
        expiresAt,
        business_id,
        
      ]);

      const updateOrderQuery = `
        UPDATE orders
        SET status_add_coupons = 'Yes'
        WHERE order_id = $1
      `;
      await pool.query(updateOrderQuery, [order_id]);
    }

    console.log(`Updated points for ${orders.length} orders`);
  } catch (error) {
    console.error("Error updating points:", error);
  }
};

cron.schedule("0 * * * *", updatePoints);
// -----------------------------------------------
module.exports = app;
