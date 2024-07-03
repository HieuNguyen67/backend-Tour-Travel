const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const pool = require("../../connectDB.js");
const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const bodyParser = require("body-parser");
const { authenticateToken } = require("../middlewares/authen.js");
const { generateRandomCode } = require("../middlewares/randomcode.js");
const {transporter}= require("../middlewares/nodemail.js");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


app.use(bodyParser.json());

pool.connect((err) => {
  if (err) {
    console.error("Business Postgres connection error:", err);
  } else {
    console.log("Business Connected to Postgres");
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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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


//-----------------------------------------------

app.post(
  "/add-tours/:business_id",
  authenticateToken,
  upload.array("images"),
  async (req, res) => {
    const currentDateTime = moment()
      .tz("Asia/Ho_Chi_Minh")
      .format("YYYY-MM-DD HH:mm:ss");
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9, $10, $11, $12, $13)
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
          currentDateTime
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

      res.status(201).json({ message: "Tour and images added successfully!", tour_id });
    } catch (error) {
      console.error("Error adding tour: ", error.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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
      const currentDateTime = moment()
        .tz("Asia/Ho_Chi_Minh")
        .format("YYYY-MM-DD HH:mm:ss");

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
            created_at = $12,
            status= 'Active'
        WHERE tour_id = $13`,
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
          currentDateTime,
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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

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

//-----------------------------------------------

app.get(
  "/list-orders-business/:businessId/:status?",
  authenticateToken,
  async (req, res) => {
    const { businessId, status } = req.params;

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
      WHERE o.business_id = $1 AND o.status = $2
      ORDER BY o.booking_date_time DESC

    `;
        params.push(businessId, status);
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
      WHERE o.business_id = $1
      ORDER BY o.booking_date_time DESC
 
    `;
        params.push(businessId);
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

//-----------------------------------------------

app.put(
  "/update-status-orders/:orderId",
  authenticateToken,
  async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    try {
     
      const query = `
        UPDATE orders 
        SET status = $1
        WHERE order_id = $2
      `;
      await pool.query(query, [status, orderId]);
   
      res.status(200).json({
        message: "Order status updated successfully",
      });
    } catch (error) {
      console.error("Failed to update Order status:", error);
      res.status(500).json({ message: "Failed to update Order status" });
    }
  }
);

app.post(
  "/update-cancellation-status/:requestId",
  authenticateToken,
  async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body;

    try {
      const cancellationRequestQuery = `
        SELECT * FROM cancellation_request WHERE request_id = $1
      `;
      const cancellationRequestResult = await pool.query(
        cancellationRequestQuery,
        [requestId]
      );

      if (cancellationRequestResult.rows.length === 0) {
        return res.status(404).json({ message: "Yêu cầu hủy không tồn tại" });
      }

      const cancellationRequest = cancellationRequestResult.rows[0];

      const orderQuery = `
        SELECT * FROM orders WHERE order_id = $1
      `;
      const orderResult = await pool.query(orderQuery, [
        cancellationRequest.order_id,
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ message: "Đơn hàng không tồn tại" });
      }

      const order = orderResult.rows[0];

      const tourQuery = `
        SELECT * FROM tours WHERE tour_id = $1
      `;
      const tourResult = await pool.query(tourQuery, [order.tour_id]);

      if (tourResult.rows.length === 0) {
        return res.status(404).json({ message: "Tour không tồn tại" });
      }

      const tour = tourResult.rows[0];

      if (status === "Confirm") {
        const startDate = new Date(tour.start_date);
        const requestDate = new Date(cancellationRequest.request_date);
        const diffTime = Math.abs(startDate - requestDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const policyQuery = `
          SELECT * FROM policy_cancellation WHERE business_id = $1 AND days_before_departure >= $2
          ORDER BY days_before_departure ASC LIMIT 1
        `;
        const policyResult = await pool.query(policyQuery, [
          cancellationRequest.business_id,
          diffDays,
        ]);

        if (policyResult.rows.length === 0) {
          return res
            .status(404)
            .json({ message: "Chính sách hủy không tồn tại" });
        }

        const policy = policyResult.rows[0];

        const refundAmount =
          (order.total_price * policy.refund_percentage) / 100;

        const updateCancellationRequestQuery = `
          UPDATE cancellation_request
          SET status = 'Confirm'
          WHERE request_id = $1
        `;
        await pool.query(updateCancellationRequestQuery, [requestId]);

        const refundQuery = `
          INSERT INTO refunds (request_id, refund_amount, status)
          VALUES ($1, $2, 'Pending')
          RETURNING *
        `;
        const refundResult = await pool.query(refundQuery, [
          requestId,
          refundAmount,
        ]);

        res.status(201).json({
          message: "Yêu cầu hủy đã được xác nhận và gửi yêu cầu hoàn tiền thành công!",
          refund: refundResult.rows[0],
        });
      } else {
        const updateCancellationRequestQuery = `
          UPDATE cancellation_request
          SET status = $1
          WHERE request_id = $2
        `;
        await pool.query(updateCancellationRequestQuery, [status, requestId]);

        res.status(200).json({
          message: `Yêu cầu hủy đã được cập nhật thành ${status}.`,
        });
      }
    } catch (error) {
      console.error("Lỗi khi cập nhật yêu cầu hủy:", error);
      res
        .status(500)
        .json({
          message: "Lỗi khi cập nhật yêu cầu hủy. Vui lòng thử lại sau.",
        });
    }
  }
);

// -----------------------------------------------


app.get("/total-revenue/:businessId", async (req, res) => {
  const { businessId } = req.params;

  try {
    const totalRevenueQuery = `
      SELECT 
        SUM(total_price) AS total_revenue
      FROM orders 
      WHERE business_id = $1 
      AND status_payment = 'Paid'
    `;

    const totalRevenueResult = await pool.query(totalRevenueQuery, [
      businessId,
    ]);

    if (totalRevenueResult.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy doanh thu cho doanh nghiệp này.",
      });
    }

    const totalRevenue = parseFloat(
      totalRevenueResult.rows[0].total_revenue
    ).toFixed(2);

    res.status(200).json({ total_revenue: totalRevenue });
  } catch (error) {
    console.error("Lỗi khi tính tổng doanh thu:", error);
    res.status(500).json({
      message: "Lỗi khi tính tổng doanh thu. Vui lòng thử lại sau.",
    });
  }
});
app.get("/revenue-by-month/:businessId/:year", async (req, res) => {
  const { businessId, year } = req.params;

  try {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const initialData = months.map((month) => ({ month, total_revenue: 0 }));

    const revenueQuery = `
      SELECT 
        EXTRACT(MONTH FROM booking_date_time) AS month,
        SUM(total_price) AS total_revenue
      FROM orders
      WHERE business_id = $1 
      AND EXTRACT(YEAR FROM booking_date_time) = $2 
      AND status_payment = 'Paid'
      GROUP BY month
      ORDER BY month
    `;

    const revenueResult = await pool.query(revenueQuery, [businessId, year]);

    revenueResult.rows.forEach((row) => {
      initialData[row.month - 1].total_revenue = parseFloat(row.total_revenue);
    });

    const allZero = initialData.every(
      (monthData) => monthData.total_revenue === 0
    );

    if (allZero) {
      res.status(200).json(null);
    } else {
      res.status(200).json(initialData);
    }
  } catch (error) {
    console.error("Lỗi khi lấy thống kê doanh thu theo tháng:", error);
    res.status(500).json({
      message:
        "Lỗi khi lấy thống kê doanh thu theo tháng. Vui lòng thử lại sau.",
    });
  }
});

app.get(
  "/order-status-ratio/:businessId",
  async (req, res) => {
    const { businessId } = req.params;

    try {
      const orderStatusRatioQuery = `
      SELECT status, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS percentage
      FROM orders
      WHERE business_id = $1
      GROUP BY status
    `;

      const result = await pool.query(orderStatusRatioQuery, [businessId]);

      const allStatuses = ["Pending", "Confirm", "Complete", "Cancel"];
      const data = allStatuses.map((status) => {
        const found = result.rows.find((row) => row.status === status);
        return {
          status,
          percentage: found ? parseFloat(found.percentage).toFixed(2) : 0.0,
        };
      });

      res.status(200).json(data);
    } catch (error) {
      console.error("Lỗi khi tính tỷ lệ trạng thái đơn hàng:", error);
      res
        .status(500)
        .json({
          message:
            "Lỗi khi tính tỷ lệ trạng thái đơn hàng. Vui lòng thử lại sau.",
        });
    }
  }
);




// -----------------------------------------------
module.exports = app;