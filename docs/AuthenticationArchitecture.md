# Local/AuthMe authentication architecture

Launcher นี้รองรับบัญชี Local ของเซิร์ฟเวอร์เพียงประเภทเดียว การสมัคร การเข้า
ระบบ การต่ออายุ session และการออกจากระบบต้องผ่าน Helios authentication
backend เท่านั้น Launcher ไม่เชื่อมต่อฐานข้อมูล AuthMe และไม่เก็บรหัสผ่าน

```text
Launcher ──HTTPS──> Helios auth backend ──HTTPS/HMAC──> Bukkit/AuthMe bridge
    │                                                       ▲
    └──short-lived ticket file──> NeoForge client mod       │
                                  └──custom payload──> NeoForge server mod
```

## Components

- `app/assets/js/authmanager.js` รองรับเฉพาะ Local login/register/refresh/logout
- `app/assets/js/localauth.js` ส่งข้อมูลไป HTTPS backend และไม่ใส่รหัสผ่านหรือ
  token ใน URL หรือ command line
- `services/auth-backend` ตรวจ input, rate limit, ออก access/refresh token และ
  one-time Minecraft ticket โดยเก็บเฉพาะ hash ของ ticket
- `services/youer-authme-bridge` เรียก AuthMe public API สำหรับ register,
  password verification และ `forceLogin`
- NeoForge companion mod ส่ง ticket หลัง Minecraft เริ่มเชื่อมต่อจริง และลบ
  ticket file หลังอ่าน

## Identity policy

- ทุก account มี `type: local`
- UUID เป็น UUID แบบ offline-mode ที่คำนวณจากชื่อแบบ case-sensitive แล้วบันทึก
  ถาวรใน backend ให้ตรงกับ Youer
- ห้ามเปลี่ยนชื่อ account เพราะจะทำให้ UUID, inventory, permissions และ mod
  playerdata แยกเป็นผู้เล่นคนใหม่
- เมื่อ Launcher รุ่น Local-only โหลด config เก่า จะเก็บเฉพาะ account ที่มี
  `type: local`, ลบ credential ของ account type ที่ไม่รองรับ และเลือก Local
  account แรกแทนถ้าบัญชีเดิมที่เลือกไว้ไม่รองรับ

## Login and session flow

1. Launcher ตรวจรูปแบบ username/password ก่อนส่ง
2. Backend ตรวจซ้ำและ rate limit ตาม IP กับ normalized username
3. Backend ส่งคำขอที่ลงลายเซ็น HMAC ไป bridge บน loopback
4. Bridge ให้ AuthMe ตรวจรหัสผ่านหรือสร้างบัญชีผ่าน public API
5. Backend ออก short-lived access token และ rotating refresh token
6. Launcher เข้ารหัส token ด้วย Electron `safeStorage`; ไม่บันทึกรหัสผ่าน
7. Logout เพิกถอน session ที่ backend ก่อนลบบัญชีออกจาก Launcher

## In-game SSO flow

1. Launcher รอจน log แสดงว่า Minecraft เริ่มเชื่อมต่อเซิร์ฟเวอร์
2. Launcher ขอ ticket อายุสั้นจาก backend ด้วย Local access token
3. Launcher เขียน envelope ลงไฟล์สิทธิ์ส่วนตัวใน instance directory
4. Client mod อ่านและลบไฟล์ แล้วส่ง ticket ผ่าน custom payload
5. Server mod ส่ง ticket พร้อม UUID/name จริงของผู้เล่นไป bridge
6. Bridge ตรวจ HMAC, timestamp และ nonce แล้วให้ backend consume ticket แบบ
   atomic โดยตรวจ server ID, UUID และชื่อ
7. เมื่อ consume สำเร็จ bridge เรียก AuthMe `forceLogin` บน Bukkit main thread
   และรอจน AuthMe ยืนยันสถานะสำเร็จ
8. Ticket หมดอายุ ใช้ซ้ำ ข้อมูลไม่ตรง หรือ service ใดไม่พร้อม ต้อง fail closed

## Threat model

| Threat | Control |
| --- | --- |
| ดัดแปลง Launcher | Backend และ server ตรวจทุก token/ticket; ไม่เชื่อใจ client |
| ขโมยรหัสผ่าน | HTTPS เท่านั้น, ไม่ persist, ไม่ log, ไม่ส่งผ่าน CLI |
| brute force / enumeration | rate limit สองมิติและ generic login error |
| ticket replay | random opaque ticket, hash-at-rest, short TTL, atomic one-time consume |
| ปลอมชื่อผู้เล่น | ticket ผูกกับ stable UUID/name และตรวจเทียบ player object จริง |
| ปลอม service request | HMAC-SHA256, timestamp, nonce cache, loopback-only ports |
| backend/bridge ล่ม | ไม่ force-login และปล่อยให้ AuthMe ปฏิเสธตามปกติ |
| token บนดิสก์ | Windows DPAPI ผ่าน Electron `safeStorage` และไฟล์สิทธิ์ส่วนตัว |

Staging ใช้ `online-mode=false` และ `enforce-secure-profile=false` ตามที่ได้รับ
อนุญาต เพื่อให้ Local UUID ตรงกัน ก่อนเปลี่ยนโหมดหรือย้ายข้อมูลจริงต้องสำรอง
playerdata, inventory และ permissions ตาม UUID ก่อนเสมอ
