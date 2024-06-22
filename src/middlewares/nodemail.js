const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

dotenv.config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "hieu01211@gmail.com",
    pass: process.env.PASS,
  },
});
module.exports = {
  transporter,
};
