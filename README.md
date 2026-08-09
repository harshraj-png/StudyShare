# StudyShare — Netlify version

This version is prepared for Netlify and uses Netlify Blobs for persistent material storage.

## Deploy

1. Create a Netlify account and log in.
2. Push this folder to GitHub OR use Netlify's repository import.
3. In Netlify, choose **Add new project → Import an existing project**.
4. Select this repository.
5. Build command: `npm run build`
6. Publish directory: `public`
7. Functions directory is already set in `netlify.toml`.
8. Deploy.

## Required environment variable

In Netlify:
**Project configuration → Environment variables**

Add:

`ADMIN_PASSWORD`

Value: choose your own private password.

Example:

`ADMIN_PASSWORD=HarshStudy@2026`

Do NOT put the real password in your source code.

## Netlify Blobs

This project uses `@netlify/blobs` for storing material files and a JSON index. It is intended for small personal study files.

## Important upload limitation

The demo function accepts files up to 5 MB because serverless request payload limits make large video uploads unsuitable for this simple function-upload approach.

For larger videos, use the next version with direct-to-cloud uploads (Supabase Storage or Cloudinary), while keeping the website hosted on Netlify.
