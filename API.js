const express = require("express");
const multer = require("multer");
// -----------------------------------------------
const app = express.Router();
const db = require("./connectDB");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");

db.connect((err) => {
  if (err) {
    console.error("Postgres connection error:", err);
  } else {
    console.log("Connected to Postgres");
  }
});


app.post("/login", (req, res) => {
  const { identifier, password } = req.body;
  const query = "SELECT * FROM admin WHERE username = $1 OR email = $1";
  db.query(query, [identifier], async (err, results) => {
    if (err) {
      console.error("Error during admin login:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const admin = results.rows[0];

    const passwordMatch = await bcrypt.compare(password, admin.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { adminId: admin.admin_id, username: admin.username },
      "your_secret_key",
      { expiresIn: "1h" }
    );

    res.status(200).json({ token, username: admin.username });
  });
});

app.get("/lay-danh-sach-user", (req, res) => {
  const query = 'SELECT * FROM "user"';
  db.query(query, (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy danh sách người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      res.json(results.rows);
    }
  });
});

app.get("/lay-danh-sach-guide", (req, res) => {
  const query =
    "SELECT tour.name, tour.start_date, tour.end_date, guide.* " +
    "FROM guide " +
    "JOIN tour ON guide.tour_id = tour.id";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy danh sách người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      res.json(results.rows);
    }
  });
});

app.delete("/xoa-user/:userID", (req, res) => {
  const userID = req.params.userID;
  const query = 'DELETE FROM "user" WHERE id = $1';
  db.query(query, [userID], (err, results) => {
    if (err) {
      console.error("Lỗi khi xoá người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      res.json({ message: "Người dùng đã được xoá thành công" });
    }
  });
});
app.delete("/xoa-guide/:guideID", (req, res) => {
  const guideID = req.params.guideID;
  const query = "DELETE FROM guide WHERE id = $1";
  db.query(query, [guideID], (err, results) => {
    if (err) {
      console.error("Lỗi khi xoá người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      res.json({ message: "Người dùng đã được xoá thành công" });
    }
  });
});

app.get("/lay-thong-tin-user/:userID", (req, res) => {
  const userID = req.params.userID;
  const query = "SELECT * FROM \"user\" WHERE id = $1";
  db.query(query, [userID], (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy thông tin người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      res.json(results.rows[0]);
    }
  });
});

app.get("/lay-thong-tin-guide/:guideID", (req, res) => {
  const guideID = req.params.guideID;
  const query = "SELECT * FROM guide WHERE id = $1";
  db.query(query, [guideID], (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy thông tin người dùng:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      const tourInfo1 = results.rows[0];
      const startDate1 = new Date(tourInfo1.birthdate);
      startDate1.setDate(startDate1.getDate() +1 );
      const formattedStartDate1 = startDate1.toISOString().split("T")[0];

      res.json({
        ...tourInfo1,
        birthdate: formattedStartDate1,
      });
    }
  });
});
app.put("/cap-nhat-user/:userID", (req, res) => {
  const userID = req.params.userID;
  const { username, email, fullname, phone, address } = req.body;
  const query =
    'UPDATE "user" SET username = $1, email = $2, fullname = $3, phone = $4, address = $5 WHERE id = $6';
  db.query(
    query,
    [username, email, fullname, phone, address, userID],
    (err, results) => {
      if (err) {
        console.error("Lỗi khi cập nhật người dùng:", err);
        res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
      } else {
        res.json({
          message: "Thông tin người dùng đã được cập nhật thành công",
        });
      }
    }
  );
});

app.put("/cap-nhat-guide/:guideID", (req, res) => {
  const guideID = req.params.guideID;
    const { fullname, email, phone, address, birthdate, tour_id} = req.body;
  const query =
    "UPDATE guide SET fullname =$1, email =$2, phone =$3, address =$4, birthdate =$5, tour_id =$6 WHERE id = $7";
  db.query(
    query,
    [fullname, email, phone, address, birthdate, tour_id, guideID],
    (err, results) => {
      if (err) {
        console.error("Lỗi khi cập nhật người dùng:", err);
        res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
      } else {
        res.json({
          message: "Thông tin người dùng đã được cập nhật thành công",
        });
      }
    }
  );
});

app.get("/lay-thong-tin-tour/:tourID", (req, res) => {
  const { tourID } = req.params;

  const query = "SELECT * FROM tour WHERE id = $1";
  db.query(query, [tourID], (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy thông tin tour:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      const tourInfo = results.rows[0];
      const startDate = new Date(tourInfo.start_date);
      startDate.setDate(startDate.getDate() + 1);
      const formattedStartDate = startDate.toISOString().split("T")[0];

      const endDate = new Date(tourInfo.end_date);
      endDate.setDate(endDate.getDate() + 1);
      const formattedEndDate = endDate.toISOString().split("T")[0];

      res.json({
        ...tourInfo,
        start_date: formattedStartDate,
        end_date: formattedEndDate,
      });
    }
  });
});

app.get("/lay-danh-sach-tour", (req, res) => {
  const query = "SELECT * FROM tour";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy danh sách tour:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      const formattedTours = results.rows.map((tour) => ({
        ...tour,
        start_date: tour.start_date.toISOString().split("T")[0],
        end_date: tour.end_date.toISOString().split("T")[0],
      }));

      res.json(formattedTours);
    }
  });
});

app.put("/cap-nhat-tour/:tourID", (req, res) => {
  const tourID = req.params.tourID;
  const {name, start_date, end_date, price, child_price,infant_price,description,quantity } = req.body;
  const query =
    "UPDATE tour SET name=$1, start_date=$2, end_date=$3, price=$4, child_price=$5,infant_price=$6,description=$7,quantity=$8  WHERE id = $9";
  db.query(
    query,
    [
      name,
      start_date,
      end_date,
      price,
      child_price,
      infant_price,
      description,
      quantity,
      tourID,
    ],
    (err, results) => {
      if (err) {
        console.error("Lỗi khi cập nhật tour:", err);
        res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
      } else {
        res.json({ message: "Thông tin tour đã được cập nhật thành công" });
      }
    }
  );
});

app.get("/lay-hinh-anh-tour/:tourID", (req, res) => {
  const tourID = req.params.tourID;
  const query = "SELECT image FROM image WHERE tour_id = $1";
  db.query(query, [tourID], (err, results) => {
    if (err) {
      console.error("Lỗi khi lấy hình ảnh tour:", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    } else {
      const base64Images = results.rows.map((result) =>
        result.image.toString("base64")
      );
      res.json(base64Images);
    }
  });
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.put(
  "/cap-nhat-hinh-anh-tour/:tourID",
  upload.array("images"),
  (req, res) => {
    const tourID = req.params.tourID;
    const images = req.files;

    db.query(
      "DELETE FROM image WHERE tour_id = $1",
      [tourID],
      (err, result) => {
        if (err) {
          console.error("Lỗi khi xóa hình ảnh cũ:", err);
          res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
        } else {
          const insertQuery = "INSERT INTO image (tour_id, image) VALUES ";
          const values = images
            .map((image, index) => {
              return `($1, $${index + 2})`;
            })
            .join(",");

          const imageBuffers = images.map((image) => image.buffer);

          db.query(
            insertQuery + values,
            [tourID, ...imageBuffers],
            (err, result) => {
              if (err) {
                console.error("Lỗi khi thêm hình ảnh mới:", err);
                res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
              } else {
                res.json({
                  message: "Hình ảnh tour đã được cập nhật thành công",
                });
              }
            }
          );
        }
      }
    );
  }
);

app.get("/get-tours", (req, res) => {
  const getToursQuery =
    "SELECT DISTINCT ON (t.id) t.*, i.image, g.fullname AS guide_name FROM tour t " +
    "LEFT JOIN image i ON t.id = i.tour_id " +
    "LEFT JOIN guide g ON t.id = g.tour_id " +
    "ORDER BY t.id, i.id"; 

  db.query(getToursQuery, (err, result) => {
    if (err) {
      console.error("Error fetching tours:", err);
      res.status(500).json({ message: "Internal server error" });
    } else {
      result.rows.forEach((tour) => {
        if (tour.image) {
          tour.image = tour.image.toString("base64");
        }
      });

      const toursWithGuides = result.rows.reduce((acc, tour) => {
        const existingTour = acc.find((item) => item.id === tour.id);

        if (existingTour) {
          existingTour.guides.push(tour.guide_name);
        } else {
          const newTour = {
            ...tour,
            guides: tour.guide_name ? [tour.guide_name] : [],
          };
          delete newTour.guide_name;
          acc.push(newTour);
        }

        return acc;
      }, []);

      res.status(200).json(toursWithGuides);
    }
  });
});

app.delete("/delete-tour/:tourID", (req, res) => {
  const tourID = req.params.tourID;
  const deleteTourQuery = "DELETE FROM tour WHERE id = $1";
  db.query(deleteTourQuery, [tourID], (err, result) => {
    if (err) {
      console.error("Error deleting tour:", err);
      res.status(500).json({ message: "Internal server error" });
    } else {
      if (result.rowCount === 0) {
        res.status(404).json({ message: "Tour not found" });
      } else {
        res.status(200).json({ message: "Tour deleted successfully" });
      }
    }
  });
});

app.get("/api/tours/:tourID", async (req, res) => {
  try {
    const tourID = req.params.tourID; 
    const query = "SELECT * FROM tour WHERE id = $1"; 
    const { rows } = await db.query(query, [tourID]);

    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ message: "Tour not found" });
    }
  } catch (error) {
    console.error("Error fetching tour details:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


app.post("/add-tour", upload.array("images", 5), async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    price,
    child_price,
    infant_price,
    description,
    quantity,
  } = req.body;
  const images = req.files;

  try {
    const insertTourQuery =
      "INSERT INTO tour (name, start_date, end_date, price, child_price, infant_price, description, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"; 

    const { rows } = await db.query(insertTourQuery, [
      name,
      start_date,
      end_date,
      price,
      child_price,
      infant_price,
      description,
      quantity,
    ]);

    const tourID = rows[0].id;

    if (images && images.length > 0) {
      images.forEach(async (image, index) => {
        const insertImageQuery =
          "INSERT INTO image (tour_id, image) VALUES ($1, $2)";
        await db.query(insertImageQuery, [tourID, image.buffer]);
        console.log(`Image ${index + 1} inserted successfully`);
      });
    }

    res.status(200).json({ message: "Tour added successfully" });
  } catch (error) {
    console.error("Error inserting tour:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
app.post("/login/user", async (req, res) => {
  const { emailOrUsername, password } = req.body;

  try {
    const query = `
      SELECT * FROM "user"
      WHERE (email = $1 OR username = $1)
    `;

    const { rows } = await db.query(query, [emailOrUsername]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, "your_secret_key", {
      expiresIn: "1h",
    });
    res.json({ success: true, user, token });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/register", async (req, res) => {
  const { username, email, password, phone, address, fullname } = req.body;

  try {
    const checkDuplicateQuery =
      'SELECT * FROM "user" WHERE username = $1 OR email = $2';
    const { rows: existingUsers } = await db.query(checkDuplicateQuery, [
      username,
      email,
    ]);
    if (existingUsers.length > 0) {
      return res
        .status(400)
        .json({ message: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertQuery =
      'INSERT INTO "user" (username, email, password, phone, address, fullname) VALUES ($1, $2, $3, $4, $5, $6)';
    await db.query(insertQuery, [
      username,
      email,
      hashedPassword,
      phone,
      address,
      fullname,
    ]);

    res.status(201).json({ message: "Registration successful" });
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
app.post("/guide_register", async (req, res) => {
  const { selectedTour, email, phone, address, fullname, birthdate } = req.body;

  try {
    const insertQuery =
      "INSERT INTO guide (tour_id, email, phone, address, fullname, birthdate) VALUES ($1, $2, $3, $4, $5, $6)";
    await db.query(insertQuery, [
      selectedTour,
      email,
      phone,
      address,
      fullname,
      birthdate,
    ]);

    res.status(201).json({ message: "Registration successful" });
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/bookings", async (req, res) => {
  const { userId, tourID, adultQuantity, childQuantity, infantQuantity } =
    req.body;
  const status = "Tiếp nhận";

  try {
    const { price, child_price, infant_price, quantity } = await getTourDetails(
      tourID
    );
    console.log(quantity);

      const total_price =
      price * adultQuantity +
      child_price * childQuantity +
      infant_price * infantQuantity;
    const userTourStatus = await getUserTourStatus(userId, tourID);

    if (userTourStatus === "Tiếp nhận" || userTourStatus === "Đã kết thúc") {
      return res
        .status(400)
        .json({ error: "You have already booked or paid for this tour." });
    } else if (
      userTourStatus === "Đã thanh toán" ||
      userTourStatus === "Đã huỷ"
    ) {
      const insertOrderQuery = `
        INSERT INTO "order" (user_id, tour_id, quantity, child_quantity, infant_quantity, total_price, status, booking_date_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `;
      const { rows } = await db.query(insertOrderQuery, [
        userId,
        tourID,
        adultQuantity,
        childQuantity,
        infantQuantity,
        total_price,
        status,
      ]);


      await updateTourQuantity(tourID, adultQuantity);
      await updateTourQuantity1(tourID, childQuantity);

      res.status(201).json({ message: "Booking successful" });
    } else {
      const insertOrderQuery = `
        INSERT INTO "order" (user_id, tour_id, quantity, child_quantity, infant_quantity, total_price, status, booking_date_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `;
      const { rows } = await db.query(insertOrderQuery, [
        userId,
        tourID,
        adultQuantity,
        childQuantity,
        infantQuantity,
        total_price,
        status,
      ]);

      await updateTourQuantity(tourID, adultQuantity);
      await updateTourQuantity1(tourID, childQuantity);

      res.status(201).json({ message: "Booking successful" });
    }
  } catch (error) {
    console.error("Error processing booking:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function getUserTourStatus(userId, tourID) {
  try {
    const selectUserTourStatusQuery = `
      SELECT status FROM "order"
      WHERE user_id = $1 AND tour_id = $2
      ORDER BY booking_date_time DESC
      LIMIT 1
    `;
    const { rows } = await db.query(selectUserTourStatusQuery, [userId, tourID]);
    const userTourStatus = rows.length > 0 ? rows[0].status : null;
    return userTourStatus;
  } catch (error) {
    console.error("Error getting user tour status:", error);
    throw error;
  }
}


async function getTourDetails(tourID) {
  return new Promise((resolve, reject) => {
    const selectTourDetailsQuery =
      "SELECT price, child_price, infant_price FROM tour WHERE id = $1";
    db.query(selectTourDetailsQuery, [tourID], (error, result) => {
      if (error) {
        console.error("Error getting tour details:", error);
        reject(error);
      } else {
        const tourDetails =
          result.rows.length > 0
            ? result.rows[0]
            : { price: 0, child_price: 0, infant_price: 0 };
        resolve(tourDetails);
      }
    });
  });
}



async function updateTourQuantity(tourID, bookedQuantity) {
  return new Promise((resolve, reject) => {
    const updateTourQuantityQuery =
      "UPDATE tour SET quantity = quantity - $1 WHERE id = $2";
    db.query(
      updateTourQuantityQuery,
      [bookedQuantity, tourID],
      (error, result) => {
        if (error) {
          console.error("Error updating tour quantity:", error);
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}
async function updateTourQuantity1(tourID, bookedQuantity) {
  return new Promise((resolve, reject) => {
    const updateTourQuantityQuery =
      "UPDATE tour SET quantity = quantity - $1 WHERE id = $2";
    db.query(
      updateTourQuantityQuery,
      [bookedQuantity, tourID],
      (error, result) => {
        if (error) {
          console.error("Error updating tour quantity:", error);
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}



app.get("/api/orders", async (req, res) => {
  try {
    const query =
      "SELECT o.id, u.fullname, u.email, u.phone, u.address, t.name, t.start_date, t.end_date, o.quantity, o.child_quantity, o.infant_quantity, o.total_price, o.status, o.booking_date_time " +
      'FROM "order" o ' +
      'JOIN "user" u ON o.user_id = u.id ' +
      "JOIN tour t ON o.tour_id = t.id";

    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/api/orders/:orderID", async (req, res) => {
  const orderID = req.params.orderID;

  try {
    const query =
      "SELECT u.*, o.*, t.name, t.id AS tour_id, t.start_date, t.end_date " +
      'FROM "order" o ' +
      'JOIN "user" u ON o.user_id = u.id ' +
      "JOIN tour t ON o.tour_id = t.id " +
      "WHERE o.id = $1";

    const { rows } = await db.query(query, [orderID]);

    if (rows.length === 0) {
      res.status(404).json({ error: "Order not found" });
    } else {
      res.json(rows[0]);
    }
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/api/orders/:orderID/status", async (req, res) => {
  const orderID = req.params.orderID;
  const newStatus = req.body.status;

  try {
    const updateStatusQuery = 'UPDATE "order" SET status = $1 WHERE id = $2';
    await db.query(updateStatusQuery, [newStatus, orderID]);

    res.json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/orders/user/:userID", (req, res) => {
  const userID = req.params.userID;
  const getOrdersByUserQuery =
    "SELECT DISTINCT ON (o.id) o.id, i.image AS image, u.fullname, u.email, u.phone, u.address, t.name, t.start_date, t.end_date, o.quantity, o.child_quantity, o.infant_quantity, o.total_price, o.status, o.booking_date_time " +
    'FROM "order" o ' +
    'LEFT JOIN "user" u ON o.user_id = u.id ' +
    "LEFT JOIN tour t ON o.tour_id = t.id " +
    "LEFT JOIN image i ON t.id = i.tour_id " +
    "WHERE o.user_id = $1 " +
    "ORDER BY o.id"; 

  db.query(getOrdersByUserQuery, [userID], (err, result) => {
    if (err) {
      console.error("Error fetching orders by user:", err);
      res.status(500).json({ error: "Internal Server Error" });
    } else {
      result.rows.forEach((tour) => {
        if (tour.image) {
          tour.image = tour.image.toString("base64");
        }
      });
      res.json(result.rows);
    }
  });
});

// -----------------------------------------------
module.exports = app;
