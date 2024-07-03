const express = require("express");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const bcrypt = require("bcryptjs");
const moment = require("moment");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const crypto = require("crypto");
const uuid = require("uuid");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const { generateRandomCode } = require("../middlewares/randomcode.js");
const { transporter } = require("../middlewares/nodemail.js");
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

app.post("/send-contact", async (req, res) => {
  const { fullname, email, phonenumber, message, address } = req.body;
  const currentDateTime = moment()
    .tz("Asia/Ho_Chi_Minh")
    .format("YYYY-MM-DD HH:mm:ss");
  try {
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
    console.error("Error sending contact:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

//-----------------------------------------------

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

    res.status(200).json({ message: "Report tour successful" });
  } catch (error) {
    console.error("Error reporting tour:", error.message);
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
      return res.status(400).json({
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

//-----------------------------------------------

app.post(
  "/book-tour/:tourId/:customerId",
  authenticateToken,
  async (req, res) => {
    const { tourId, customerId } = req.params;
    const { adult_quantity, child_quantity, infant_quantity, note } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
    try {
      const tourQuery = `SELECT * FROM tours WHERE tour_id = $1`;
      const tourResult = await pool.query(tourQuery, [tourId]);

      if (tourResult.rows.length === 0) {
        return res.status(404).json({ message: "Tour không tồn tại" });
      }

      const tour = tourResult.rows[0];
      const total_quantity = adult_quantity + child_quantity + infant_quantity;

      if (tour.quantity < total_quantity) {
        return res.status(400).json({ message: "Số lượng không đủ" });
      }

      const total_price =
        tour.adult_price * adult_quantity +
        tour.child_price * child_quantity +
        tour.infant_price * infant_quantity;

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
        status_request_cancel
      ) VALUES ($1, $2, $3, $4, $5, 'Unpaid', $6, $7, $8, $9, $10, 'Pending', 'Not Rated', 'No') RETURNING *
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
      ]);
      const orderId = orderResult.rows[0].order_id;

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
    "https://ee54-123-22-104-248.ngrok-free.app/v1/api/customer/momo/webhook",
};

app.post(
  "/book-tour-momopay/:tourId/:customerId",
  authenticateToken,
  async (req, res) => {
    const { tourId, customerId } = req.params;
    const {
      adult_quantity,
      child_quantity,
      infant_quantity,
      note,
      paymentMethod,
    } = req.body;
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      const tourQuery = `SELECT * FROM tours WHERE tour_id = $1`;
      const tourResult = await pool.query(tourQuery, [tourId]);

      if (tourResult.rows.length === 0) {
        return res.status(404).json({ message: "Tour không tồn tại" });
      }

      const tour = tourResult.rows[0];
      const total_quantity = adult_quantity + child_quantity + infant_quantity;

      if (tour.quantity < total_quantity) {
        return res.status(400).json({ message: "Số lượng không đủ" });
      }

      const total_price =
        tour.adult_price * adult_quantity +
        tour.child_price * child_quantity +
        tour.infant_price * infant_quantity;
      const code_order = generateRandomCode(10);

      const orderQuery = `
      INSERT INTO orders (
        tour_id, adult_quantity, child_quantity, infant_quantity, total_price,
        status_payment, booking_date_time, note, customer_id, business_id, 
        code_order, status, status_rating, status_request_cancel
      ) VALUES ($1, $2, $3, $4, $5, 'Unpaid', $6, $7, $8, $9, $10, 'Pending', 'Not Rated', 'No')
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
      ]);

      const order = orderResult.rows[0];
      const order_Id = orderResult.rows[0].order_id;

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
      const orderResult = await pool.query(orderQuery, [
        originalOrderId
      ]);
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

      res.status(201).json({
        message: "Đánh giá đã được ghi nhận thành công!",
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
    const { reason } = req.body;
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

      const cancellationRequestQuery = `
        INSERT INTO cancellation_request (order_id, request_date, reason, status, status_refund, business_id, customer_id)
        VALUES ($1, $2, $3, 'Pending', 'No', $4, $5)
        RETURNING *
      `;

      const cancellationRequestResult = await pool.query(
        cancellationRequestQuery,
        [orderId, currentDateTime, reason, businessId, customerId]
      );

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
      query += " WHERE cr.customer_id = $1";
      queryParams.push(customerId);
    } else if (businessId) {
      query += " WHERE cr.business_id = $1";
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

// -----------------------------------------------
module.exports = app;
