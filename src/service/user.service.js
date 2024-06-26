const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(bodyParser.json());

pool.connect((err) => {
  if (err) {
    console.error("User Postgres connection error:", err);
  } else {
    console.log("User Connected to Postgres");
  }
});

//-----------------------------------------------

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
      process.env.SECRET_KEY
    );
    res.json({
      token,
      role: account.role_id,
      username: account.username,
      account_id: account.account_id,
      business_id: account.business_id,
      customer_id: account.customer_id,
      admin_id: account.admin_id,
    });
  } catch (error) {
    console.error("Đăng nhập không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng nhập không thành công. Vui lòng thử lại sau." });
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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

app.get("/news-categories", authenticateToken, async (req, res) => {
  try {
    const categories = await pool.query("SELECT * FROM NewsCategories");
    res.json(categories.rows);
  } catch (error) {
    console.error("Failed to fetch news categories:", error);
    res.status(500).json({ message: "Failed to fetch news categories." });
  }
});

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

app.get("/order-detail/:orderId", authenticateToken, async (req, res) => {
  const { orderId } = req.params;

  try {
    const orderDetailQuery = `
      SELECT 
        o.order_id,
        o.tour_id,
        t.name AS tour_name,
        o.adult_quantity,
        o.child_quantity,
        o.infant_quantity,
        t.start_date,
        t.end_date,
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
        o.status_request_cancel
      FROM orders o
      JOIN tours t ON o.tour_id = t.tour_id
      JOIN customers c ON o.customer_id = c.customer_id
      JOIN accounts a ON c.account_id = a.account_id
      WHERE o.order_id = $1
    `;

    const orderDetailResult = await pool.query(orderDetailQuery, [orderId]);

    if (orderDetailResult.rows.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    res.status(200).json(orderDetailResult.rows[0]);
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết đơn hàng:", error);
    res.status(500).json({ message: "Lỗi khi lấy chi tiết đơn hàng" });
  }
});

//-----------------------------------------------

app.get("/payment-detail/:orderId", authenticateToken, async (req, res) => {
  const { orderId } = req.params;

  try {
    const paymentDetailQuery = `
      SELECT 
        p.payment_id,
        p.order_id,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.payment_status,
        o.tour_id,
        o.code_order,
        t.name AS tour_name,
        c.account_id,
        a.name AS customer_name
      FROM payments p
      JOIN orders o ON p.order_id = o.order_id
      JOIN tours t ON o.tour_id = t.tour_id
      JOIN customers c ON o.customer_id = c.customer_id
      JOIN accounts a ON c.account_id = a.account_id
      WHERE p.order_id = $1
    `;

    const paymentDetailResult = await pool.query(paymentDetailQuery, [orderId]);

    if (paymentDetailResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy chi tiết thanh toán" });
    }

    res.status(200).json(paymentDetailResult.rows[0]);
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết thanh toán:", error);
    res.status(500).json({ message: "Lỗi khi lấy chi tiết thanh toán" });
  }
});

app.get(
  "/detail-cancellation-request/:requestId",
  authenticateToken,
  async (req, res) => {
    const { requestId } = req.params;

    try {
      const query = `
      SELECT 
        cr.request_id,
        cr.order_id,
        cr.request_date,
        cr.reason,
        cr.status,
        cr.status_refund,
        cr.customer_id,
        cr.business_id,
        o.booking_date_time,
        o.code_order,
        t.name AS tour_name,
        t.start_date,
        t.end_date,
        o.status_payment,
        a.name AS customer_name,
        o.total_price
      FROM cancellation_request cr
      JOIN orders o ON cr.order_id = o.order_id
      JOIN tours t ON o.tour_id = t.tour_id
      JOIN customers c ON cr.customer_id = c.customer_id
      JOIN accounts a ON c.account_id = a.account_id
      WHERE cr.request_id = $1
    `;

      const result = await pool.query(query, [requestId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Yêu cầu hủy không tồn tại" });
      }

      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error("Lỗi khi lấy chi tiết yêu cầu hủy:", error);
      res.status(500).json({ message: "Lỗi khi lấy chi tiết yêu cầu hủy" });
    }
  }
);

// -----------------------------------------------
module.exports = app;