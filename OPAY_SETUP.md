# OPay Payment Integration Setup Guide

This guide will help you set up OPay payment gateway for your smart lecture assistant to accept payments for study materials.

## Prerequisites

1. **OPay Merchant Account**: You need a merchant account with OPay
   - Sign up at [OPay Merchant Dashboard](https://dashboard.opaycheckout.com)
   - Complete the registration process
   - Contact OPay team to move from test to production mode

2. **Supabase Database**: Update your database with the payment records table

## Step 1: Update Database Schema

Run the updated schema in your Supabase SQL Editor:

1. Go to your Supabase dashboard → SQL Editor
2. Open `supabase-schema.sql` from your project
3. Run the entire script (it includes the new `payment_records` table)

The new table will track:
- Payment transactions
- Customer information
- Payment status
- Transaction references

## Step 2: Configure Environment Variables

Add the following to your `.env` file:

```env
# OPay Payment Configuration
VITE_OPAY_MERCHANT_ID=your_merchant_id_here
VITE_OPAY_SECRET_KEY=your_secret_key_here
VITE_OPAY_BASE_URL=https://api.opaycheckout.com
VITE_OPAY_CALLBACK_URL=https://your-domain.com/api/payment/callback
```

### Getting Your OPay Credentials

1. Log into your [OPay Merchant Dashboard](https://dashboard.opaycheckout.com)
2. Navigate to **Settings → API**
3. Copy your **Merchant ID** and **Secret Key**
4. Paste them into your `.env` file

### Environment Variables Explained

- `VITE_OPAY_MERCHANT_ID`: Your OPay merchant identifier
- `VITE_OPAY_SECRET_KEY`: Your secret key for API authentication (keep this secure!)
- `VITE_OPAY_BASE_URL`: OPay API endpoint (use `https://api.opaycheckout.com` for production)
- `VITE_OPAY_CALLBACK_URL`: URL where OPay will send payment status updates

## Step 3: Set Up Callback URL (Optional)

For production, you should set up a webhook endpoint to receive payment notifications:

1. In your OPay dashboard, go to **Settings → Webhooks**
2. Add your callback URL: `https://your-domain.com/api/payment/callback`
3. OPay will send POST requests to this URL with payment status updates

**Note**: For development/testing, the current implementation uses polling to check payment status, so the callback URL is optional initially.

## Step 4: Test the Integration

### Testing with OPay Test Mode

1. OPay provides test credentials when you first sign up
2. Use these to test the payment flow without real money
3. Test different payment methods:
   - Bank Card
   - Bank Transfer
   - OPay Wallet
   - QR Code

### Testing Flow

1. Navigate to the **Study Materials** page
2. Find a paid material (marked with lock icon)
3. Click "Pay [Amount]" button
4. Fill in the payment form (email, name, phone)
5. Select payment method
6. Complete payment in the OPay popup
7. Wait for payment verification (automatic polling)
8. Access the material once payment is confirmed

## Step 5: Go Live

When ready for production:

1. Contact OPay to enable your account for production
2. Update your environment variables with production credentials
3. Set up your callback URL for real-time payment notifications
4. Test with a small transaction first
5. Monitor your OPay dashboard for transaction analytics

## Payment Methods Supported

- **Bank Card**: Visa, Mastercard, Verve
- **Bank Transfer**: Direct bank transfer
- **OPay Wallet**: OPay wallet balance
- **OPay QR Code**: Scan QR to pay
- **Bank USSD**: USSD payment (Nigeria)

## Security Notes

- **Never commit your `.env` file** to version control
- Keep your secret key secure
- Use HTTPS in production
- Validate payment signatures on your callback endpoint
- Implement rate limiting for payment attempts

## Troubleshooting

### "OPay credentials not configured" error
- Check that environment variables are set correctly
- Restart your dev server after updating `.env`
- Verify variable names match exactly

### Payment verification timeout
- The polling system waits up to 1 minute
- If timeout occurs, user can retry
- Check OPay dashboard for transaction status

### Invalid API key error
- Verify your merchant ID and secret key are correct
- Ensure you're using the right environment (test vs production)
- Check that your OPay account is active

## Support

For OPay-specific issues:
- [OPay Documentation](https://documentation.opaycheckout.com/)
- [OPay Support](https://www.opaycheckout.com/contact)

For application issues, check the browser console for error messages.
