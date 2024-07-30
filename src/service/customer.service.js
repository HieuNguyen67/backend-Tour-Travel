const express = require("express");
// -----------------------------------------------
const multer = require("multer");
const app = express.Router();
const pool = require("../../connectDB.js");
const bcrypt = require("bcryptjs");
const moment = require("moment");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const { generateRandomCode } = require("../middlewares/randomcode.js");
const { transporter } = require("../middlewares/nodemail.js");
const ExcelJS = require("exceljs");
const upload = multer({ storage: multer.memoryStorage() });

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
    console.error("Customer Postgres connection error:", err);
  } else {
    console.log("Customer Connected to Postgres");
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

  if (!data.phone_number) {
    errors.push("Số điện thoại là bắt buộc.");
  } else if (!/^\d{10}$/.test(data.phone_number)) {
    errors.push("Số điện thoại phải có 10 chữ số.");
  }

  if (!data.address) {
    errors.push("Địa chỉ là bắt buộc.");
  } else if (typeof data.address !== "string" || data.address.trim() === "") {
    errors.push("Địa chỉ không hợp lệ.");
  }

  return errors;
}

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

    res.json({ message: "Đăng ký thành công!" });
  } catch (error) {
    console.error("Đăng ký không thành công:", error);
    res
      .status(500)
      .json({ message: "Đăng ký không thành công. Vui lòng thử lại sau." });
  }
});

//-----------------------------------------------
function validateContact(data) {
  const errors = [];

  if (
    !data.fullname ||
    data.fullname.length < 3 ||
    data.fullname.length > 100
  ) {
    errors.push("Tên đầy đủ phải từ 3 đến 100 ký tự.");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email || !emailRegex.test(data.email)) {
    errors.push("Email không hợp lệ.");
  }

  if (data.phonenumber && !/^\d{10}$/.test(data.phonenumber)) {
    errors.push("Số điện thoại phải có 10 chữ số.");
  }
  if (!data.message || data.message.length < 10 || data.message.length > 500) {
    errors.push("Tin nhắn phải từ 10 đến 500 ký tự.");
  }

  if (data.address && data.address.length > 255) {
    errors.push("Địa chỉ không được dài quá 255 ký tự.");
  }

  return errors;
}
app.post("/send-contact", async (req, res) => {
  const { fullname, email, phonenumber, message, address } = req.body;
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  try {
    const errors = validateContact(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const query = `
      INSERT INTO contacts (fullname, email, phonenumber, message, senttime, address, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Pending')
    `;
    await pool.query(query, [
      fullname,
      email,
      phonenumber,
      message,
      currentDateTime,
      address,
    ]);

    res.status(201).json({ message: "Gửi thông tin liên hệ thành công !" });
  } catch (error) {
    console.error("Failed to send contact:", error);
    res.status(500).json({ message: "Gửi thông tin liên hệ thất bại !" });
  }
});

//-----------------------------------------------

app.post("/send-contact-business/:businessId/:tourId", async (req, res) => {
  const { businessId, tourId } = req.params;
  const { fullname, email, phonenumber, message } = req.body;
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  try {
    const errors = validateContact(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const newContact = await pool.query(
      "INSERT INTO contacts_business (business_id, tour_id, fullname, email, phonenumber, message, status,senttime) VALUES ($1, $2, $3, $4, $5, $6, 'Pending', $7) RETURNING *",
      [
        businessId,
        tourId,
        fullname,
        email,
        phonenumber,
        message,
        currentDateTime,
      ]
    );

    res.status(201).json(newContact.rows[0]);
  } catch (error) {
    console.error("Lỗi khi gửi liên hệ:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

//-----------------------------------------------

app.get("/list-tours-filter/:business_id?", async (req, res) => {
  const { tourcategory_name } = req.query;
  const { business_id } = req.params;
  if (!tourcategory_name) {
    return res.status(400).json({ error: "Cần có danh mục tour" });
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
      t.status = 'Active' AND tc.name = $1 AND a.status = 'Active' AND t.quantity > 0
    
  `;

    const params = [tourcategory_name];
  
  if (business_id) {
    query += ` AND t.business_id = $2`;
    params.push(business_id);
  }

  query += `
  GROUP BY
      t.tour_id, departure_location_name, dl.location_departure_id, tc.name
    ORDER BY
      t.start_date ASC
  `;

  try {
    const result = await pool.query(query, params);

    const tours = result.rows.map((row) => ({
      ...row,
      image: row.image ? row.image.toString("base64") : null,
    }));

    res.json(tours);
  } catch (error) {
    console.error("Lỗi khi thực hiện truy vấn", error.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});


//-----------------------------------------------

app.post("/report-tour/:tourId/:customerId", async (req, res) => {
  const { tourId, customerId } = req.params;
  const { type_report, description } = req.body;
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  try {
    const query = `
      INSERT INTO tour_reports (tour_id, customer_id, reportdate, type_report, description, status)
      VALUES ($1, $2, $3, $4, $5, 'Pending')
    `;
    const values = [
      tourId,
      customerId,
      currentDateTime,
      type_report,
      description,
    ];
    const result = await pool.query(query, values);

    res.status(200).json({ message: "Report tour thành công" });
  } catch (error) {
    console.error("Lỗi khi report tour:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

//-----------------------------------------------

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

//-----------------------------------------------

app.post(
  "/book-tour/:tourId/:customerId/:shareToken?",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    const { tourId, customerId, shareToken } = req.params;
    const {
      adult_quantity,
      child_quantity,
      infant_quantity,
      note,
      passengers: passengersFromBody,
    } = req.body;

    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      const query = `
      SELECT 
       account_id
      FROM 
        customers 
      WHERE 
      customer_id = $1`;
      const result = await pool.query(query, [customerId]);
      const account = result.rows[0];

      const customerQuery = `
        SELECT phone_number, name, address, email
        FROM accounts 
        WHERE account_id = $1
      `;
      const customerResult = await pool.query(customerQuery, [account.account_id]);

      if (customerResult.rows.length === 0) {
        return res.status(404).json({ message: "Khách hàng không tồn tại" });
      }

      const customer = customerResult.rows[0];
      if (
        !customer.phone_number ||
        !customer.name ||
        !customer.address ||
        !customer.email
      ) {
        return res.status(400).json({
          message:
            "Khách hàng chưa điền đầy đủ thông tin liên hệ.",
        });
      }

      
      const tourQuery = "SELECT * FROM tours WHERE tour_id = $1";
      const tourResult = await pool.query(tourQuery, [tourId]);

      if (tourResult.rows.length === 0) {
        return res.status(404).json({ message: "Tour không tồn tại" });
      }

      const tour = tourResult.rows[0];
      const total_quantity =
        parseInt(adult_quantity) +
        parseInt(child_quantity) +
        parseInt(infant_quantity);
      if (tour.quantity < total_quantity) {
        return res.status(400).json({ message: "Số lượng không đủ" });
      }

      const total_price =
        tour.adult_price * adult_quantity +
        tour.child_price * child_quantity +
        tour.infant_price * infant_quantity;

      let passengers = [];

      if (req.file) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet("Passengers");

        passengers = [];
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber > 2) {
            const birthdate = moment(row.getCell(2).value, "DD/MM/YYYY").format(
              "YYYY-MM-DD"
            );
            const passenger = {
              name: row.getCell(1).value,
              birthdate: birthdate,
              gender: row.getCell(3).value,
              passport_number: row.getCell(4).value,
              type: row.getCell(5).value,
            };
            passengers.push(passenger);
          }
        });
        if (passengers.length !== total_quantity) {
          return res.status(400).json({
            message:
              "Số lượng không trùng khớp với số lượng đặt tour. Bạn cần cung cấp ít nhất 1 thông tin của khách hàng",
          });
        }
        var passengersParse = passengers;
      } else {
        passengers = passengersFromBody;
        var passengersParse = JSON.parse(passengers);
      }

      let validShareToken = null;

      if (shareToken) {
        const checkshareTokenQuery = `
          SELECT * FROM shared_links 
          WHERE share_token = $1 
          AND customer_id = $2
        `;
        const checkCustomerShareTokenResult = await pool.query(
          checkshareTokenQuery,
          [shareToken, customerId]
        );

        if (checkCustomerShareTokenResult.rows.length === 0) {
          const shareTokenQuery = `
          SELECT * FROM shared_links 
          WHERE share_token = $1 
          AND tour_id = $2
        `;
          const shareTokenResult = await pool.query(shareTokenQuery, [
            shareToken,
            tourId,
          ]);

          if (shareTokenResult.rows.length > 0) {
            const checkOrderQuery = `
          SELECT * FROM orders 
          WHERE customer_id = $1 
          AND share_token = $2
        `;
            const checkOrderParams = [customerId, shareToken];
            const checkOrderResult = await pool.query(
              checkOrderQuery,
              checkOrderParams
            );

            if (checkOrderResult.rows.length === 0) {
              validShareToken = shareToken;
            }
          }
        }
      }

      const orderQuery = `
        INSERT INTO orders (
          tour_id, 
          adult_quantity, 
          child_quantity, 
          infant_quantity, 
          total_price, 
          status_payment, 
          booking_date_time, 
          note, 
          customer_id, 
          business_id, 
          code_order, 
          status, 
          status_rating,
          status_request_cancel, 
          status_payment_business,
          share_token,
          status_add_coupons
        ) VALUES ($1, $2, $3, $4, $5, 'Unpaid', $6, $7, $8, $9, $10, 'Pending', 'Not Rated', 'No', 'Unpaid', $11, 'No') RETURNING *
      `;

      const code_order = generateRandomCode(10);

      const orderResult = await pool.query(orderQuery, [
        tourId,
        adult_quantity,
        child_quantity,
        infant_quantity,
        total_price,
        currentDateTime,
        note,
        customerId,
        tour.business_id,
        code_order,
        validShareToken,
      ]);
      const orderId = orderResult.rows[0].order_id;

      const passengerInsertQuery = `
        INSERT INTO passengers (order_id, name, birthdate, gender, passport_number, type) 
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      for (const passenger of passengersParse) {
        await pool.query(passengerInsertQuery, [
          orderId,
          passenger.name,
          passenger.birthdate === "Invalid date" ? null : passenger.birthdate,
          passenger.gender === null ? null : passenger.gender,
          passenger.passport_number === null ? null : passenger.passport_number,
          passenger.type === null ? null : passenger.type,
        ]);
      }

      const updateTourQuery = `
        UPDATE tours 
        SET quantity = quantity - $1 
        WHERE tour_id = $2
      `;
      await pool.query(updateTourQuery, [total_quantity, tourId]);

      const orderDetails = await getOrderDetails(orderId);
      await sendConfirmationEmail(orderDetails);

      res.status(201).json({
        message: "Quý khách đã đặt tour thành công!",
        order: orderResult.rows[0],
      });
    } catch (error) {
      console.error("Đặt tour không thành công:", error);
      res.status(500).json({
        message: "Đặt tour không thành công. Vui lòng thử lại sau.",
      });
    }
  }
);

async function getOrderDetails(orderId) {
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
  const updatedOrderDetailResult = await pool.query(orderDetailQuery, [
    orderId,
  ]);
  return updatedOrderDetailResult.rows[0];
}

async function sendConfirmationEmail(orderDetails) {
  const mailOptions = {
    from: "Tour Travel <your-email@gmail.com>",
    to: orderDetails.email,
    subject: "Yêu Cầu Thanh Toán",
    html: `
      <h3 style="font-weight: bold; font-size: 1.6rem;">TOUR TRAVEL</h3>
      <div style="background: #84ffff; border: 5px solid #00796b;">
          <p style="text-align: center; padding: 2rem; color: black;">
              Cảm ơn quý khách đã sử dụng dịch vụ của chúng tôi
              <br />
              Booking của quý khách đã được chúng tôi xác nhận thành công!
          </p>
      </div>
      <h4 style="font-size: 1.5rem;">
          Phiếu xác nhận booking
          <span style="border: 3px solid red; color: red;">
              CHƯA THANH TOÁN
          </span>
      </h4>
      <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
          <p>Mã booking: <strong>${orderDetails.code_order}</strong></p>
          <p>Tên Tour: <strong>${orderDetails.tour_name}</strong></p>
          <p>Ngày đi: <strong>${formatDate1(
            orderDetails.start_date
          )}</strong></p>
          <p>Điểm khởi hành: <strong>${orderDetails.location_name}</strong></p>
          <p>Số lượng Người lớn: <strong>${
            orderDetails.adult_quantity
          }</strong>, Trẻ em: <strong>${
      orderDetails.child_quantity
    }</strong>, Trẻ nhỏ: <strong>${orderDetails.infant_quantity}</strong></p>
          <p>
              Tổng tiền:
              <span style="color: red; font-weight: bold; font-size: 1.3rem;">
                  ${formatPrice(orderDetails.total_price)}
              </span>
          </p>
          <p>Ngày booking: <strong>${formatDate(
            orderDetails.booking_date_time
          )}</strong></p>
          <p>Ghi chú: <strong>${orderDetails.note}</strong></p>
          <p>Thời hạn thanh toán: <strong>24 tiếng</strong></p>
          <p style="color: red; font-weight: bold;">
              Quý khách vui lòng thanh toán trong 24h kể từ thời gian booking. Nếu quá thời hạn trên, quý khách chưa thanh toán, Tour Travel sẽ tự động huỷ booking này.
          </p>
      </div>
      <h4 style="font-weight: bold; font-size: 1.6rem;">THANH TOÁN</h4>
      <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
          <p>Nếu quý khách chưa thanh toán. Để hoàn tất quá trình đặt tour, Quý khách vui lòng đăng nhập vào Trang Web Tour Travel và bấm vào chi tiết đơn đặt hàng trong phần thông tin cá nhân và chọn phương thức thanh toán.</p>
          <p>Nếu quý khách đã thanh toán vui lòng bỏ qua email này.</p>
          <p>Quý khách có thể kiểm tra thông tin chi tiết về đơn hàng của mình bằng cách đăng nhập vào tài khoản của mình trên trang web của chúng tôi.</p>
          <p>Nếu Quý khách có bất kỳ câu hỏi nào, xin vui lòng liên hệ với chúng tôi qua email này.</p>
      </div>
      <h4 style="font-weight: bold; font-size: 1.6rem;">THÔNG TIN KHÁCH HÀNG</h4>
      <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
          <p>Khách hàng: <strong>${orderDetails.customer_name}</strong></p>
          <p>Email: <strong>${orderDetails.email}</strong></p>
          <p>SĐT: <strong>${orderDetails.phone_number}</strong></p>
          <p>Địa chỉ: <strong>${orderDetails.address}</strong></p>
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

//-----------------------------------------------

const momoConfig = {
  partnerCode: "MOMO",
  accessKey: "F8BBA842ECF85",
  secretKey: "K951B6PE1waDMi640xX08PD3vg6EkVlz",
  endpoint: "https://test-payment.momo.vn/v2/gateway/api/create",
  ipnUrl:
    "https://ee26-171-253-128-178.ngrok-free.app/v1/api/customer/momo/webhook",
};

app.post(
  "/book-tour-momopay/:tourId/:customerId/:shareToken?",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    const { tourId, customerId, shareToken } = req.params;
    const {
      adult_quantity,
      child_quantity,
      infant_quantity,
      note,
      paymentMethod,
      passengers: passengersFromBody,
    } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");

    try {

            const query = `
      SELECT 
       account_id
      FROM 
        customers 
      WHERE 
      customer_id = $1`;
            const result = await pool.query(query, [customerId]);
            const account = result.rows[0];

            const customerQuery = `
        SELECT phone_number, name, address, email
        FROM accounts 
        WHERE account_id = $1
      `;
            const customerResult = await pool.query(customerQuery, [
              account.account_id,
            ]);

            if (customerResult.rows.length === 0) {
              return res
                .status(404)
                .json({ message: "Khách hàng không tồn tại" });
            }

            const customer = customerResult.rows[0];
            if (
              !customer.phone_number ||
              !customer.name ||
              !customer.address ||
              !customer.email
            ) {
              return res.status(400).json({
                message: "Khách hàng chưa điền đầy đủ thông tin liên hệ.",
              });
            }


      const tourQuery = `SELECT * FROM tours WHERE tour_id = $1`;
      const tourResult = await pool.query(tourQuery, [tourId]);

      if (tourResult.rows.length === 0) {
        return res.status(404).json({ message: "Tour không tồn tại" });
      }

      const tour = tourResult.rows[0];
      const total_quantity =
        parseInt(adult_quantity) +
        parseInt(child_quantity) +
        parseInt(infant_quantity);
      if (tour.quantity < total_quantity) {
        return res.status(400).json({ message: "Số lượng không đủ" });
      }

      const total_price =
        tour.adult_price * adult_quantity +
        tour.child_price * child_quantity +
        tour.infant_price * infant_quantity;
      let passengers = [];

      if (req.file) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet("Passengers");

        passengers = [];
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber > 2) {
            const birthdate = moment(row.getCell(2).value, "DD/MM/YYYY").format(
              "YYYY-MM-DD"
            );

            const passenger = {
              name: row.getCell(1).value,
              birthdate: birthdate,
              gender: row.getCell(3).value,
              passport_number: row.getCell(4).value,
              type: row.getCell(5).value,
            };
            passengers.push(passenger);
          }
        });
        if (passengers.length !== total_quantity) {
          console.error(
            "Số lượng khách hàng từ file Excel không trùng khớp với số lượng đặt tour:",
            passengers.length,
            total_quantity
          );
          return res.status(400).json({
            message:
              "Số lượng khách hàng từ file Excel không trùng khớp với số lượng đặt tour",
          });
        }
        var passengersParse = passengers;
      } else {
        passengers = passengersFromBody;
        var passengersParse = JSON.parse(passengers);
      }

      let validShareToken = null;

      if (shareToken) {
        const checkshareTokenQuery = `
          SELECT * FROM shared_links 
          WHERE share_token = $1 
          AND customer_id = $2
        `;
        const checkCustomerShareTokenResult = await pool.query(
          checkshareTokenQuery,
          [shareToken, customerId]
        );

        if (checkCustomerShareTokenResult.rows.length === 0) {
          const shareTokenQuery = `
          SELECT * FROM shared_links 
          WHERE share_token = $1 
          AND tour_id = $2
        `;
          const shareTokenResult = await pool.query(shareTokenQuery, [
            shareToken,
            tourId,
          ]);

          if (shareTokenResult.rows.length > 0) {
            const checkOrderQuery = `
          SELECT * FROM orders 
          WHERE customer_id = $1 
          AND share_token = $2
        `;
            const checkOrderParams = [customerId, shareToken];
            const checkOrderResult = await pool.query(
              checkOrderQuery,
              checkOrderParams
            );

            if (checkOrderResult.rows.length === 0) {
              validShareToken = shareToken;
            }
          }
        }
      }

      const code_order = generateRandomCode(10);

      const orderQuery = `
      INSERT INTO orders (
        tour_id, adult_quantity, child_quantity, infant_quantity, total_price,
        status_payment, booking_date_time, note, customer_id, business_id, 
        code_order, status, status_rating, status_request_cancel, status_payment_business, share_token, status_add_coupons
      ) VALUES ($1, $2, $3, $4, $5, 'Unpaid', $6, $7, $8, $9, $10, 'Pending', 'Not Rated', 'No', 'Unpaid', $11, 'No')
      RETURNING *
    `;

      const orderResult = await pool.query(orderQuery, [
        tourId,
        adult_quantity,
        child_quantity,
        infant_quantity,
        total_price,
        currentDateTime,
        note,
        customerId,
        tour.business_id,
        code_order,
        validShareToken,
      ]);

      const order = orderResult.rows[0];
      const order_Id = orderResult.rows[0].order_id;

      const passengerInsertQuery = `
      INSERT INTO passengers (order_id, name, birthdate, gender, passport_number, type) 
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
      for (const passenger of passengersParse) {
        await pool.query(passengerInsertQuery, [
          order_Id,
          passenger.name,
          passenger.birthdate === "Invalid date" ? null : passenger.birthdate,
          passenger.gender === null ? null : passenger.gender,
          passenger.passport_number === null ? null : passenger.passport_number,
          passenger.type === null ? null : passenger.type,
        ]);
      }

      const updateTourQuery = `UPDATE tours SET quantity = quantity - $1 WHERE tour_id = $2`;
      await pool.query(updateTourQuery, [total_quantity, tourId]);

      const orderDetails = await getOrderDetails(order_Id);

      await sendConfirmationEmail(orderDetails);

      const requestId = `${Date.now()}`;
      const orderId = code_order;
      const orderInfo = `Thanh toan cho don hang ${code_order}`;
      const amount = total_price.toString();
      const extraData = "";
      const requestType = paymentMethod;

      const returnUrl = `http://localhost:3000/checkout`;

      const rawSignature = `accessKey=${momoConfig.accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${momoConfig.ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${momoConfig.partnerCode}&redirectUrl=${returnUrl}&requestId=${requestId}&requestType=${requestType}`;
      const signature = crypto
        .createHmac("sha256", momoConfig.secretKey)
        .update(rawSignature)
        .digest("hex");

      const requestBody = {
        partnerCode: momoConfig.partnerCode,
        partnerName: "Test",
        storeId: "MomoTestStore",
        requestId: requestId,
        amount: amount,
        orderId: orderId,
        orderInfo: orderInfo,
        redirectUrl: returnUrl,
        ipnUrl: momoConfig.ipnUrl,
        lang: "vi",
        requestType: requestType,
        autoCapture: true,
        extraData: extraData,
        orderGroupId: "",
        signature: signature,
      };

      const paymentResponse = await axios.post(
        momoConfig.endpoint,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (paymentResponse.data.resultCode !== 0) {
        return res
          .status(500)
          .json({ message: "Tạo thanh toán không thành công." });
      }

      res.status(201).json({
        message: "Quý khách đã đặt tour thành công! Vui lòng thanh toán.",
        order: order,
        payment_url: paymentResponse.data.payUrl,
      });
    } catch (error) {
      console.error("Đặt tour không thành công:", error);
      res.status(500).json({
        message: "Đặt tour không thành công. Vui lòng thử lại sau.",
      });
    }
  }
);

app.post(
  "/payment-tour-momopay/:code_order/:total_price",
  authenticateToken,
  async (req, res) => {
    const { total_price, code_order } = req.params;
    const { paymentMethod } = req.body;

    try {
      const requestId = `${Date.now()}`;
      const orderId = `${code_order}-${Date.now()}`;
      const orderInfo = `Thanh toan cho don hang ${code_order}`;
      const amount = total_price.toString();
      const extraData = "";

      const requestType = paymentMethod;

      const returnUrl = `http://localhost:3000/checkout`;

      const rawSignature = `accessKey=${momoConfig.accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${momoConfig.ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${momoConfig.partnerCode}&redirectUrl=${returnUrl}&requestId=${requestId}&requestType=${requestType}`;
      const signature = crypto
        .createHmac("sha256", momoConfig.secretKey)
        .update(rawSignature)
        .digest("hex");

      const requestBody = {
        partnerCode: momoConfig.partnerCode,
        partnerName: "Test",
        storeId: "MomoTestStore",
        requestId: requestId,
        amount: amount,
        orderId: orderId,
        orderInfo: orderInfo,
        redirectUrl: returnUrl,
        ipnUrl: momoConfig.ipnUrl,
        lang: "vi",
        requestType: requestType,
        autoCapture: true,
        extraData: extraData,
        orderGroupId: "",
        signature: signature,
      };

      const paymentResponse = await axios.post(
        momoConfig.endpoint,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (paymentResponse.data.resultCode !== 0) {
        return res
          .status(500)
          .json({ message: "Tạo thanh toán không thành công." });
      }
      res.status(201).json({
        payment_url: paymentResponse.data.payUrl,
      });
    } catch (error) {
      console.error("Tạo thanh toán không thành công:", error);
      res.status(500).json({
        message: "Tạo thanh toán không thành công. Vui lòng thử lại sau.",
      });
    }
  }
);

//-----------------------------------------------

app.post("/momo/webhook", async (req, res) => {
  const {
    partnerCode,
    requestId,
    orderId,
    resultCode,
    transId,
    amount,
    message,
    orderInfo,
    orderType,
    payType,
    responseTime,
    extraData,
    signature,
  } = req.body;
  // console.log("callback: ");
  // console.log(req.body);
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  try {
    const originalOrderId = orderId.split("-")[0];

    if (resultCode === 0) {
      const updateOrderQuery = `
        UPDATE orders
        SET status_payment = 'Paid'
        WHERE code_order = $1
      `;

      await pool.query(updateOrderQuery, [originalOrderId]);

      const method = partnerCode + " " + payType;
      const paymentQuery = `
        INSERT INTO payments (
          order_id,
          payment_date,
          amount,
          payment_method,
          payment_status
        ) VALUES (
          (SELECT order_id FROM orders WHERE code_order = $1),
          $2,
          $3,
          $4,
          'Completed'
        )
      `;

      await pool.query(paymentQuery, [
        originalOrderId,
        currentDateTime,
        amount,
        method,
      ]);

      const orderQuery = `SELECT order_id FROM orders WHERE code_order = $1`;
      const orderResult = await pool.query(orderQuery, [originalOrderId]);
      const order_Id = orderResult.rows[0].order_id;

      const updatedOrderDetailResult = await getOrderDetails(order_Id);

      const mailOptions = {
        from: "Tour Travel <your-email@gmail.com>",
        to: updatedOrderDetailResult.email,
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
          updatedOrderDetailResult.code_order
        }</strong></p>
        <p style="color: red;">Xin quý khách vui lòng nhớ số booking để thuận tiện cho giao dịch sau này.</p>
        <p>Tên Tour: <strong>${updatedOrderDetailResult.tour_name}</strong></p>
        <p>Ngày đi: <strong>${formatDate(
          updatedOrderDetailResult.start_date
        )}</strong></p>
        <p>Điểm khởi hành: <strong>${
          updatedOrderDetailResult.location_name
        }</strong></p>
        <p>Số lượng Người lớn: <strong>${
          updatedOrderDetailResult.adult_quantity
        }</strong>, Trẻ em: <strong>${
          updatedOrderDetailResult.child_quantity
        }</strong>, Trẻ nhỏ: <strong>${
          updatedOrderDetailResult.infant_quantity
        }</strong></p>
        <p>
            Tổng tiền: 
            <span style="color: red; font-weight: bold; font-size: 1.3rem;">
                ${formatPrice(updatedOrderDetailResult.total_price)}
            </span>
        </p>
        <p>Ngày booking: <strong>${formatDate(
          updatedOrderDetailResult.booking_date_time
        )}</strong></p>
        <p>Ghi chú: <strong>${updatedOrderDetailResult.note}</strong></p>
        
    </div>
    <h4 style="font-weight: bold; font-size: 1.6rem;">THÔNG TIN KHÁCH HÀNG</h4>
    <div style="background: #f5f5f5; border: 5px solid #212121; padding: 1rem;">
        <p>Khách hàng: <strong>${
          updatedOrderDetailResult.customer_name
        }</strong></p>
        <p>Email: <strong>${updatedOrderDetailResult.email}</strong></p>
        <p>SĐT: <strong>${updatedOrderDetailResult.phone_number}</strong></p>
        <p>Địa chỉ: <strong>${updatedOrderDetailResult.address}</strong></p>
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

    res.status(200).json({ message: "success" });
  } catch (error) {
    console.error("Payment update failed:", error);
    res.status(500).json({ message: "failed" });
  }
});

//-----------------------------------------------

app.get(
  "/list-orders-customer/:customerId/:status?",
  authenticateToken,
  async (req, res) => {
    const { customerId, status } = req.params;

    try {
      let ordersQuery;
      const params = [];
      if (status) {
        ordersQuery = `
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
        o.status_rating
      FROM orders o
      JOIN tours t ON o.tour_id = t.tour_id
      WHERE o.customer_id = $1 AND o.status = $2
      ORDER BY o.booking_date_time DESC

    `;
        params.push(customerId, status);
      } else {
        ordersQuery = `
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
        o.status_rating
      FROM orders o
      JOIN tours t ON o.tour_id = t.tour_id
      WHERE o.customer_id = $1
      ORDER BY o.booking_date_time DESC
 
    `;
        params.push(customerId);
      }

      const ordersResult = await pool.query(ordersQuery, params);

      if (ordersResult.rows.length === 0) {
        return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
      }

      res.status(200).json(ordersResult.rows);
    } catch (error) {
      console.error("Lỗi khi lấy danh sách đơn hàng:", error);
      res.status(500).json({ message: "Lỗi khi lấy danh sách đơn hàng" });
    }
  }
);

app.post(
  "/rate-tour/:customerId/:tourId/:code_order",
  authenticateToken,
  async (req, res) => {
    const { customerId, tourId, code_order } = req.params;
    const { rating, review } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    try {
      const ratingQuery = `
        INSERT INTO ratings (customer_id, tour_id, rating, review, date_rating)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const ratingResult = await pool.query(ratingQuery, [
        customerId,
        tourId,
        rating,
        review,
        currentDateTime,
      ]);

      const updateOrderQuery = `
        UPDATE orders
        SET status_rating = 'Rated'
        WHERE code_order = $1 
      `;

      await pool.query(updateOrderQuery, [code_order]);

      const businessQuery = `
        SELECT business_id
        FROM tours
        WHERE tour_id = $1
      `;

      const businessResult = await pool.query(businessQuery, [tourId]);
      const businessId = businessResult.rows[0].business_id;

      const couponQuery = `
        INSERT INTO coupons (customer_id, points, description, created_at, expires_at, is_used, business_id)
        VALUES ($1, 4000, 'Xu từ đánh giá chuyến đi', $2, $3, 'Unused', $4)
      `;

     const expiresAt = moment()
       .tz("Asia/Ho_Chi_Minh")
       .add(6, "months")
       .format("YYYY-MM-DD HH:mm:ss");


      await pool.query(couponQuery, [
        customerId,
        currentDateTime,
        expiresAt,
        businessId,
      ]);

      res.status(201).json({
        message:
          "Đánh giá đã được ghi nhận thành công và bạn đã nhận được 5000 điểm thưởng!",
        rating: ratingResult.rows[0],
      });
    } catch (error) {
      console.error("Lỗi khi ghi nhận đánh giá:", error);
      res
        .status(500)
        .json({ message: "Lỗi khi ghi nhận đánh giá. Vui lòng thử lại sau." });
    }
  }
);

app.post(
  "/request-cancellation/:orderId/:businessId/:customerId",
  authenticateToken,
  async (req, res) => {
    const { orderId, businessId, customerId } = req.params;
    const { reason, statusOrder } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    try {
      const customerQuery = `
        SELECT bank_account_name, bank_account_number, bank_name 
        FROM customers 
        WHERE customer_id = $1
      `;
      const customerResult = await pool.query(customerQuery, [customerId]);

      if (customerResult.rows.length === 0) {
        return res.status(404).json({ message: "Khách hàng không tồn tại" });
      }

      const customer = customerResult.rows[0];
      if (
        !customer.bank_account_name ||
        !customer.bank_account_number ||
        !customer.bank_name
      ) {
        return res.status(400).json({
          message:
            "Khách hàng chưa điền đầy đủ thông tin tài khoản ngân hàng trong hồ sơ cá nhân.",
        });
      }

      if (statusOrder === "Confirm") {
        const cancellationRequestQuery = `
        INSERT INTO cancellation_request (order_id, request_date, reason, status, status_refund, business_id, customer_id)
        VALUES ($1, $2, $3, 'Pending', 'No', $4, $5)
        RETURNING *
      `;
        var cancellationRequestResult = await pool.query(
          cancellationRequestQuery,
          [orderId, currentDateTime, reason, businessId, customerId]
        );
      } else {
        const cancellationRequestQuery = `
        INSERT INTO cancellation_request (order_id, request_date, reason, status, status_refund, business_id, customer_id)
        VALUES ($1, $2, 'Khác', 'Confirm', 'No', $3, $4)
        RETURNING *
      `;
        var cancellationRequestResult = await pool.query(
          cancellationRequestQuery,
          [orderId, currentDateTime, businessId, customerId]
        );
        const { request_id } = cancellationRequestResult.rows[0];

        const OrdersQuery = "SELECT * FROM orders WHERE order_id =$1";
        const OrdersResult = await pool.query(OrdersQuery, [orderId]);
        const Total_price = OrdersResult.rows[0].total_price;

        const createRefundQuery = `
        INSERT INTO refunds (request_id, refund_amount, status, request_refund_date)
        VALUES ($1, $2, 'Pending', $3)
        RETURNING *
      `;
        await pool.query(createRefundQuery, [
          request_id,
          Total_price,
          currentDateTime,
        ]);
      }

      const updateOrderQuery = `
      UPDATE orders 
      SET status_request_cancel = 'Yes' 
      WHERE order_id = $1
    `;
      await pool.query(updateOrderQuery, [orderId]);

      res.status(201).json({
        message: "Yêu cầu hủy đơn hàng đã được ghi nhận thành công!",
        cancellationRequest: cancellationRequestResult.rows[0],
      });
    } catch (error) {
      console.error("Lỗi khi ghi nhận yêu cầu hủy đơn hàng:", error);
      res.status(500).json({
        message: "Lỗi khi ghi nhận yêu cầu hủy đơn hàng. Vui lòng thử lại sau.",
      });
    }
  }
);

app.get("/list-cancellation-requests", authenticateToken, async (req, res) => {
  const { customerId, businessId } = req.query;

  try {
    let query = `
      SELECT 
        cr.*,
        o.code_order
      FROM cancellation_request cr
      LEFT JOIN orders o ON cr.order_id= o.order_id
    `;
    const queryParams = [];

    if (customerId) {
      query += " WHERE cr.customer_id = $1 ORDER BY cr.request_date DESC";
      queryParams.push(customerId);
    } else if (businessId) {
      query += " WHERE cr.business_id = $1 ORDER BY cr.request_date DESC";
      queryParams.push(businessId);
    } else {
      return res
        .status(400)
        .json({ message: "Vui lòng cung cấp customerId hoặc businessId" });
    }

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy yêu cầu hủy" });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách yêu cầu hủy:", error);
    res.status(500).json({ message: "Lỗi khi lấy danh sách yêu cầu hủy" });
  }
});

app.get("/list-passengers/:orderId", authenticateToken, async (req, res) => {
  const { orderId } = req.params;

  try {
    const passengersQuery = `
      SELECT 
        passenger_id,
        order_id,
        name,
        birthdate,
        gender,
        passport_number,
        type
      FROM passengers
      WHERE order_id = $1
    `;

    const passengersResult = await pool.query(passengersQuery, [orderId]);

    if (passengersResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy hành khách cho đơn hàng này." });
    }

    res.status(200).json(passengersResult.rows);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách hành khách:", error);
    res.status(500).json({
      message: "Lỗi khi lấy danh sách hành khách. Vui lòng thử lại sau.",
    });
  }
});

app.get("/download-excel-template", async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Passengers");

  worksheet.mergeCells("A1:E1");
  const titleRow = worksheet.getCell("A1");
  titleRow.value = `NHẬP DANH SÁCH HÀNH KHÁCH ĐI TOUR`;
  titleRow.font = { size: 16, bold: true };
  titleRow.alignment = { vertical: "middle", horizontal: "center" };
  worksheet.getRow(1).height = 30;

  worksheet.addRow([
    "Họ và Tên",
    "Ngày sinh (dd/mm/yyyy)",
    "Giới tính (Nam, Nữ)",
    "Số CCCD/Passport (Nếu có)",
    "Loại KH (Người lớn, Trẻ em, Trẻ nhỏ)",
  ]);

  worksheet.columns = [
    { key: "name", width: 30 },
    { key: "birthdate", width: 20 },
    { key: "gender", width: 20 },
    { key: "passport_number", width: 25 },
    { key: "type", width: 35 },
  ];

  worksheet.getColumn("birthdate").numFmt = "dd/mm/yyyy";

  const numRows = 100;

  for (let i = 1; i <= numRows; i++) {
    ["A", "B", "C", "D", "E"].forEach((col) => {
      worksheet.getCell(`${col}${i}`).border = {
        top: { style: "medium" },
        left: { style: "medium" },
        bottom: { style: "medium" },
        right: { style: "medium" },
      };
    });
  }

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="passenger_template.xlsx"'
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  await workbook.xlsx.write(res);
  res.end();
});

// -----------------------------------------------

app.post("/share-tour/:tourId/:customerId", async (req, res) => {
  const { tourId, customerId } = req.params;
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");

  try {
    const existingLinkQuery = `
      SELECT * FROM shared_links
      WHERE tour_id = $1 AND customer_id = $2
    `;
    const existingLinkResult = await pool.query(existingLinkQuery, [
      tourId,
      customerId,
    ]);

    if (existingLinkResult.rows.length > 0) {
      const existingLink = existingLinkResult.rows[0];
      const shareLink = `http://localhost:3000/tour-share-link/${existingLink.tour_id}/${existingLink.share_token}`;

      return res.status(200).json({
        message: "Link chia sẻ tour đã tồn tại!",
        shareLink,
      });
    }

    const shareToken = uuidv4();

    const createShareLinkQuery = `
      INSERT INTO shared_links (tour_id, customer_id, share_token, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const { rows } = await pool.query(createShareLinkQuery, [
      tourId,
      customerId,
      shareToken,
      currentDateTime,
    ]);
    const shareLink = `http://localhost:3000/tour-share-link/${rows[0].tour_id}/${rows[0].share_token}`;

    res.status(201).json({
      message: "Đã tạo link chia sẻ tour thành công!",
      shareLink,
    });
  } catch (error) {
    console.error("Lỗi khi tạo link chia sẻ tour:", error);
    res.status(500).json({
      message: "Lỗi khi tạo link chia sẻ tour. Vui lòng thử lại sau.",
    });
  }
});

// -----------------------------------------------

app.get("/shared-tour/:shareToken", async (req, res) => {
  const { shareToken } = req.params;

  try {
    const getShareLinkQuery = `
      SELECT tour_id, share_token
      FROM shared_links
      WHERE share_token = $1
    `;
    const { rows } = await pool.query(getShareLinkQuery, [shareToken]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Link chia sẻ không hợp lệ ." });
    }

    res.status(200).json({
      message: "Link chia sẻ hợp lệ.",
      shareToken,
    });
  } catch (error) {
    console.error("Lỗi khi truy cập link chia sẻ:", error);
    res.status(500).json({
      message: "Lỗi khi truy cập link chia sẻ. Vui lòng thử lại sau.",
    });
  }
});
// -----------------------------------------------

app.get("/list-rate-tour/:customerId", async (req, res) => {
  const { customerId } = req.params;
  const { statusRating } = req.query; 

  try {
    const ordersQuery = `
      SELECT o.* , t.name
      FROM orders o
      LEFT JOIN tours t ON o.tour_id = t.tour_id

      WHERE o.customer_id = $1 
      AND o.status = 'Complete' 
      AND o.status_rating = $2
    `;

    const result = await pool.query(ordersQuery, [customerId, statusRating]);
    const orders = result.rows;

    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res
      .status(500)
      .json({ message: "Error fetching orders. Please try again later." });
  }
});


// -----------------------------------------------
module.exports = app;
