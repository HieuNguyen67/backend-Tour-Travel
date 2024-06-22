const express = require("express");
const router = express.Router();
const AdminRouter = require("../service/admin.service");
const UserRouter = require("../service/user.service");
const BusinessRouter = require("../service/business.service");
const CustomerRouter = require("../service/customer.service");

router.get("/example", (req, res) => {
  res.send("Example route");
});

module.exports = (app) => {
  app.use("/v1/api/admin", AdminRouter);
   app.use("/v1/api/user", UserRouter);
    app.use("/v1/api/business", BusinessRouter);
     app.use("/v1/api/customer", CustomerRouter);
};
