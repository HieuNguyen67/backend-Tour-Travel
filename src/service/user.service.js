const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const moment = require("moment");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const { OAuth2Client } = require("google-auth-library");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const { generateRandomCode } = require("../middlewares/randomcode.js");
const dotenv = require("dotenv");
dotenv.config();
const client = new OAuth2Client(process.env.CLIENT_ID);


app.use(bodyParser.json());

pool.connect((err) => {
  if (err) {
    console.error("User Postgres connection error:", err);
  } else {
    console.log("User Connected to Postgres");
  }
});

//-----------------------------------------------
function validateLogin(data) {
  const errors = [];

  if (!data.usernameOrEmail) {
    errors.push("Tên đăng nhập hoặc email là bắt buộc.");
  } else if (
    typeof data.usernameOrEmail !== "string" ||
    data.usernameOrEmail.trim() === ""
  ) {
    errors.push("Tên đăng nhập hoặc email không hợp lệ.");
  } else if (
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
      data.usernameOrEmail
    ) &&
    !/^[a-zA-Z0-9_.-]{3,}$/.test(data.usernameOrEmail)
  ) {
    errors.push("Tên đăng nhập hoặc email không đúng định dạng.");
  }

  if (!data.password) {
    errors.push("Mật khẩu là bắt buộc.");
  } else if (typeof data.password !== "string" || data.password.length < 5) {
    errors.push("Mật khẩu phải có ít nhất 5 ký tự.");}
  else if (/\s/.test(data.password)) {
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

  return errors;
}

app.post("/login", async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  try {
     const errors = validateLogin(req.body);
     if (errors.length > 0) {
       return res.status(400).json({ errors });
     }

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
      process.env.SECRET_KEY,
      // { expiresIn: "24h" }
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

app.post("/auth/google", async (req, res) => {
  const { tokenId } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub, email, name, picture } = payload;

    const query = `SELECT a.*, c.customer_id
      FROM 
        accounts a
      LEFT JOIN customers c ON a.account_id = c.account_id
      WHERE a.google_id = $1 OR a.email = $2`;
    const result = await pool.query(query, [sub, email]);
    let account = result.rows[0];

    if (!account) {
      const insertQuery = `
        INSERT INTO accounts (username, email, name, google_id, status, role_id, confirmation_code, use_confirmation_code)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`;
      const confirmationCode = generateRandomCode(5);
      const insertResult = await pool.query(insertQuery, [
        email,
        email,
        name,
        sub,
        "Active",
        1,
        confirmationCode,
        "used",
      ]);
      account = insertResult.rows[0];

      const customerQuery =
        "INSERT INTO customers (account_id) VALUES ($1) RETURNING customer_id";
      const customerResult = await pool.query(customerQuery, [
        account.account_id,
      ]);
      account.customer_id = customerResult.rows[0].customer_id;
    }

    const token = jwt.sign(
      { account_id: account.account_id, username: account.username },
      process.env.SECRET_KEY
      // { expiresIn: "24h" }
    );

    res.json({
      token,
      role: account.role_id,
      username: account.username,
      account_id: account.account_id,
      customer_id: account.customer_id,
    });
  } catch (error) {
    console.error("Đăng nhập bằng Google không thành công:", error);
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
    res.status(500).json({ message: "Đã xảy ra lỗi. Vui lòng thử lại sau nhé." });
  }
});

//-----------------------------------------------
function validateUpdateAccount(data) {
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

  if (data.name && (typeof data.name !== "string" || data.name.trim() === "")) {
    errors.push("Tên không hợp lệ.");
  } else if (/[!@#$%^&*]/.test(data.name)) {
    errors.push("Tên không được chứa ký tự đặc biệt !.");
  }

  if (data.birth_of_date && isNaN(Date.parse(data.birth_of_date))) {
    errors.push("Ngày sinh không hợp lệ.");
  }

  if (data.phone_number && !/^\d{10}$/.test(data.phone_number)) {
    errors.push("Số điện thoại phải có 10 chữ số.");
  }

  if (
    data.address &&
    (typeof data.address !== "string" || data.address.trim() === "")
  ) {
    errors.push("Địa chỉ không hợp lệ.");
  }

  

  if (
    data.bank_account_name &&
    (typeof data.bank_account_name !== "string" ||
      data.bank_account_name.trim() === "")
  ) {
    errors.push("Tên tài khoản ngân hàng không hợp lệ.");
  } else if (/[!@#$%^&*]/.test(data.bank_account_name)) {
    errors.push("Tên không được chứa ký tự đặc biệt !.");
  }

  if (data.bank_account_number && !/^\d+$/.test(data.bank_account_number)) {
    errors.push("Số tài khoản ngân hàng chỉ được chứa chữ số.");
  }


  return errors;
}

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
    const errors = validateUpdateAccount(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
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

app.get("/accounts/image/:accountId?/:businessId?", async (req, res) => {
  const { accountId, businessId } = req.params;

  try {
    let query;
    let queryParams = [];
    let accountIdToUse;

    if (businessId) {
      query = "SELECT account_id FROM business WHERE business_id = $1";
      const result = await pool.query(query, [businessId]);

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({
            message: "Không tìm thấy tài khoản tương ứng với business_id.",
          });
      }

      accountIdToUse = result.rows[0].account_id;
    } else if (accountId) {
      accountIdToUse = accountId;
    } else {
      return res
        .status(400)
        .json({
          message:
            "Cần phải cung cấp ít nhất một tham số: accountId hoặc businessId.",
        });
    }

    query = "SELECT image FROM accounts WHERE account_id = $1";
    const imageResult = await pool.query(query, [accountIdToUse]);

    const imageData = imageResult.rows[0].image;
    if (imageData) {
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
    console.error("Lỗi khi lấy danh mục tin tức:", error);
    res.status(500).json({ message: "Lỗi khi lấy danh mục tin tức" });
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
    console.error("Lỗi khi lấy chi tiết tin tức:", error);
    res.status(500).json({ message: "Lỗi khi lấy chi tiết tin tức" });
  }
});

//-----------------------------------------------

app.get("/list-news-travel/:category", async (req, res) => {
  try {
    const category = req.params.category;
    const query = `
      SELECT n.news_id, n.title, LEFT(n.content, 100) as content, nc.name as category_name, n.created_at, n.status, n.note, n.image,
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
      ORDER BY n.created_at DESC
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
    console.error("Lỗi khi lấy chi tiết tin tức:", error);
    res.status(500).json({ message: "Lỗi khi lấy chi tiết tin tức" });
  }
});

//-----------------------------------------------

app.get("/locations", async (req, res) => {
  const { location_type } = req.query;
  try {
    const query =
      "SELECT * FROM locations WHERE location_type = $1 ORDER BY location_name ASC";
    const result = await pool.query(query, [location_type]);
    res.json(result.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách địa điểm:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


//-----------------------------------------------

app.get("/get-tour/:tourId", async (req, res) => {
  try {
    const tourId = req.params.tourId;

    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");

    const tourQuery = await pool.query(
      `SELECT t.*,
              a.name as account_name,
              tc.name as category_name,
              dl.location_departure_id,
              array_agg(ldes.location_name) as destination_location_name,
              ldep.location_name as departure_location_name,
              array_agg(dst.location_destination_id) as destination_locations,
              COALESCE(d.discount_percentage, 0) AS discount_percentage
       FROM tours t
       LEFT JOIN business b ON t.business_id = b.business_id
       LEFT JOIN tourcategories tc ON t.tourcategory_id = tc.tourcategory_id
       LEFT JOIN accounts a ON b.account_id = a.account_id
       LEFT JOIN departurelocation dl ON t.tour_id = dl.tour_id
       LEFT JOIN locations ldep ON dl.location_departure_id = ldep.location_id
       LEFT JOIN destinationlocation dst ON t.tour_id = dst.tour_id
       LEFT JOIN locations ldes ON dst.location_destination_id = ldes.location_id
       LEFT JOIN discounts d ON t.tour_id = d.tour_id AND $1 BETWEEN d.start_date AND d.end_date
       WHERE t.tour_id = $2
       GROUP BY t.tour_id, a.name, category_name, departure_location_name, dl.location_departure_id, d.discount_percentage`,
      [currentDateTime, tourId]
    );

    if (tourQuery.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy tour" });
    }

    const tour = tourQuery.rows[0];
      const discount = tour.discount_percentage || 0;
      const adult_price_discount = tour.adult_price * (1 - discount / 100);
      const child_price_discount = tour.child_price * (1 - discount / 100);
      const infant_price_discount = tour.infant_price * (1 - discount / 100);

      tour.adult_price_discount = adult_price_discount;
      tour.child_price_discount = child_price_discount;
      tour.infant_price_discount = infant_price_discount;

    res.status(200).json(tour);
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết tour:", error.message);
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
      return res.status(404).json({ error: "Không tìm thấy hình ảnh cho tour này" });
    }

    const imagesBase64 = [];

    for (let i = 0; i < imageQuery.rows.length; i++) {
      const imageData = imageQuery.rows[i].image;
      const base64Image = Buffer.from(imageData, "binary").toString("base64");
      imagesBase64.push({ tour_id: tourId, image: base64Image });
    }

    res.status(200).json(imagesBase64);
  } catch (error) {
    console.error("Lõi khi lấy hình ảnh tour:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

//-----------------------------------------------

app.get("/get-ratings-tour/:tour_code", async (req, res) => {
  const { tour_code } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT a.name, r.rating, r.review, r.date_rating
      FROM ratings r
      LEFT JOIN
      customers c ON r.customer_id = c.customer_id
      LEFT JOIN 
      accounts a ON c.account_id = a.account_id
      LEFT JOIN 
      tours t ON r.tour_id = t.tour_id
      WHERE t.tour_code = $1
    `,
      [tour_code]
    );

    const averageRating = await pool.query(
      `
      SELECT AVG(r.rating) as avg_rating, COUNT(r.*) as total_ratings
      FROM ratings r
      LEFT JOIN 
      tours t ON r.tour_id = t.tour_id
      WHERE t.tour_code = $1
    `,
      [tour_code]
    );

    res.json({
      reviews: result.rows,
      averageRating: parseFloat(averageRating.rows[0].avg_rating).toFixed(2),
      totalRatings: parseInt(averageRating.rows[0].total_ratings, 10),
    });
  } catch (error) {
    console.error("Lỗi khi lấy đánh giá tour:", error.message);
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
        t.tour_code,
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
        o.status_request_cancel,
        tc.name as category_name
      FROM orders o
      JOIN tours t ON o.tour_id = t.tour_id
      JOIN tourcategories tc ON t.tourcategory_id = tc.tourcategory_id
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
