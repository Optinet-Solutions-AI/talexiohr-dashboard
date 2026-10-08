This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## User accounts

Sign-in is required for every dashboard page and API route (see `src/proxy.ts`).
There is no self-service signup: an administrator provisions accounts with

```bash
node scripts/provision-users.mjs --admin chris@example.com --user a@example.com,b@example.com --disable-others
```

Each account gets a random 16-character temporary password, printed once by
the script. On first sign-in the user is sent to `/change-password` and cannot
reach anything else until they set a password that meets the policy in
`src/lib/auth/password.ts` (12+ chars, upper, lower, digit, symbol).

Roles live in `app_metadata.role` (`admin` or `user`). `--disable-others`
bans every existing account that is neither listed nor an admin.
