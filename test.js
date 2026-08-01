require("dotenv").config();
const Razorpay = require("razorpay");
console.log("Key ID:", JSON.stringify(process.env.RAZORPAY_KEY_ID));
console.log("Secret Length:", process.env.RAZORPAY_KEY_SECRET.length);
console.log("Secret Starts:", process.env.RAZORPAY_KEY_SECRET.substring(0, 6));

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID.trim(),
    key_secret: process.env.RAZORPAY_KEY_SECRET.trim(),
});

(async () => {
    try {
        const order = await razorpay.orders.create({
            amount: 100,
            currency: "INR",
            receipt: "test123"
        });

        console.log(order);

    } catch (e) {
        console.log("STATUS:", e.statusCode);
        console.log("ERROR:", e.error);
        console.log("FULL:", e);
    }
})();