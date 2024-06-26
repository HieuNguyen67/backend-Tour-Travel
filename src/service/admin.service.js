const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const moment = require("moment-timezone");
const bodyParser = require("body-parser");
const {authenticateToken} = require("../middlewares/authen.js");
const {generateRandomCode}= require("../middlewares/randomcode.js");
const {transporter}= require("../middlewares/nodemail.js");
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

      res.status(200).json({
        message: "Cập nhật tài khoản thành công !",
      });
    } catch (error) {
      await pool.query("ROLLBACK");
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

      const newsInsertValues = [title, content, newscategory_id, accountId,currentDateTime];
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

cron.schedule("0 0 * * *", updateTourStatuses);

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
app.get("/pending-count-status-orders", (req, res) => {
  getPendingCount("orders", "Pending", res);
});
app.get("/pending-count-status-request-cancel", (req, res) => {
  getPendingCount("cancellation_request", "Pending", res);
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
    const toursResult = await client.query(toursQuery, [currentDate]);

    const tourIds = toursResult.rows.map((row) => row.tour_id);

    if (tourIds.length > 0) {
      const updateQuery = `
        UPDATE orders 
        SET status = 'Complete' 
        WHERE tour_id = ANY($1) 
        AND status = 'Confirm'
      `;
      await client.query(updateQuery, [tourIds]);
      console.log("Orders updated successfully");
    } else {
      console.log("No tours to update");
    }
  } catch (error) {
    console.error("Error updating orders:", error);
  }
};

cron.schedule("0 0 * * *", () => {
  console.log("Running cron job to update complete orders");
  updateOrders();
});
// -----------------------------------------------
module.exports = app;
