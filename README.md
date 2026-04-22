# A-Network

A-Network is a full-stack application built around three linked product layers:

- Web2 off-chain application services
- Web3 on-chain ANET token visibility and wallet integration on BNB Smart Chain
- Web4 coordination concepts that connect off-chain utility and on-chain ownership

The current product includes a Flutter app, a Node.js/Fastify backend, a PostgreSQL database, public legal pages, and a public website surface.

Important notice:

- A-Network is a long-term ecosystem project.
- It is not financial advice.
- It does not promise guaranteed earnings, guaranteed returns, or token appreciation.
- Store listing text, website text, and in-app text should remain factual, risk-aware, and compliant with Google Play and App Store policies.

## Current Product Scope

The codebase currently implements:

- User registration and login with JWT-based authentication
- A 6-hour session-based off-chain mining engine
- Global stats and leaderboard endpoints
- On-chain ANET balance lookup through the deployed token contract
- Flutter mobile UI with multi-slide product narrative
- In-app legal links for Privacy Policy and Terms of Service
- Public docs pages for website, privacy, and terms

The codebase does not currently implement:

- Guaranteed financial returns
- Brokerage or custodial financial services
- Automatic off-chain to on-chain reward minting for users
- A production claim bridge from off-chain app balance into on-chain wallet balance

## Actual Tech Stack

Backend:

- Node.js
- Fastify
- PostgreSQL
- JWT
- bcryptjs
- dotenv

Frontend:

- Flutter
- Dart
- http
- shared_preferences
- google_mobile_ads
- video_player
- webview_flutter
- url_launcher

Website / Docs:

- Static HTML in `docs/`
- GitHub Pages compatible structure

## Repository Structure

```text
A Network/
├── backend/
│   ├── db.js
│   ├── database_schema.sql
│   ├── server.js
│   ├── middleware/
│   ├── routes/
│   └── services/
├── docs/
│   ├── index.html
│   ├── privacy.html
│   └── terms.html
├── my_app/
│   ├── lib/
│   ├── assets/
│   ├── web/
│   └── pubspec.yaml
└── README.md
```

## Mining Logic In Code

The current backend mining rules are defined in:

- `backend/services/miningEngine.js`
- `backend/services/halving.js`
- `backend/routes/mining.js`

### Mining Session Duration

- One mining session lasts exactly `21,600` seconds
- This equals `6` hours

### Base Rate

```text
BASE_RATE = 0.001 ANET/second
MAX_SUPPLY = 21,000,000 ANET
```

### Current Rate Formula

```text
currentRate = BASE_RATE x (1 + halvingCount)
```

This is a reverse-halving model in the current codebase because the rate increases as `halvingCount` increases.

### Reward Formula

```text
reward = currentRate x 21,600
```

Examples:

- `halvingCount = 0` -> `reward = 0.001 x 21,600 = 21.6 ANET`
- `halvingCount = 1` -> `reward = 0.002 x 21,600 = 43.2 ANET`
- `halvingCount = 2` -> `reward = 0.003 x 21,600 = 64.8 ANET`

### Eligibility Rule

A user becomes eligible for the network halving calculation only when:

```text
successful_sessions >= 1000
```

### Halving Count Formula

```text
eligibleUsers = count(users where successful_sessions >= 1000)
halvingCount = floor(eligibleUsers / 210000)
```

Examples:

- `0` to `209,999` eligible users -> `halvingCount = 0`
- `210,000` to `419,999` eligible users -> `halvingCount = 1`
- `420,000` to `629,999` eligible users -> `halvingCount = 2`

### User Rules Enforced By The API

- User must be authenticated to start and complete mining
- User must exist in the database
- User cannot start a second session while `is_mining = true`
- User cannot complete mining before 6 full hours pass
- On successful completion:
  - user `balance` increases
  - `successful_sessions` increments by 1
  - `is_mining` becomes `false`

### Supply Protection Rules

- If `total_mined >= MAX_SUPPLY`, mining rewards stop
- If `total_mined + reward > MAX_SUPPLY`, reward is reduced to the exact remaining supply
- When max supply is reached, `is_mining_active` is disabled in network stats

## Web2, Web3, and Web4 Positioning

### Web2 Layer

The current application includes an off-chain session engine, user accounts, ranking, app-native progression, and backend-controlled reward accounting.

### Web3 Layer

The current application and website can read ANET token information from the deployed token contract on BNB Smart Chain.

Contract address:

```text
0x791055A7d52AA392eaE8De04250497f33807E46A
```

### Web4 Layer

Web4 is currently presented as the coordination layer between off-chain utility and on-chain ownership. The product narrative is implemented in the Flutter app and website, but a full production claim bridge is not yet implemented in the backend.

## Backend Setup

### Install Dependencies

```bash
cd backend
npm install
```

### Database Setup

Create a PostgreSQL database and load the schema:

```bash
psql -U postgres -d anetwork -f database_schema.sql
```

### Backend Environment

Example `.env`:

```env
PORT=3000

DB_USER=postgres
DB_HOST=localhost
DB_NAME=anetwork
DB_PASS=your_password
DB_PORT=5432

JWT_SECRET=ANET_SECRET_KEY

ANET_CONTRACT=0x791055A7d52AA392eaE8De04250497f33807E46A
ANET_DECIMALS=18
BSCSCAN_API_URL=https://api.bscscan.com/api
BSCSCAN_API_KEY=
```

### Start Backend

```bash
npm start
```

## Flutter App Setup

```bash
cd my_app
flutter pub get
flutter run
```

Current app capabilities include:

- login and register
- mining slide
- main dashboard slide
- web3 slide with in-app browser and wallet actions
- web4 concept slide
- whitepaper, privacy, and terms slide

Current app build command:

```bash
flutter build apk --release --no-obfuscate
```

## API Surface

Authentication:

- `POST /auth/register`
- `POST /auth/login`

Mining:

- `POST /mining/start`
- `GET /mining/status/:userId`
- `POST /mining/complete`

Stats:

- `GET /stats/network`
- `GET /stats/onchain/:address`

Leaderboard:

- `GET /leaderboard/top`
- `GET /leaderboard/rank/:userId`

User:

- `POST /user/create`

## Website And Legal Pages

The docs folder contains the public website and legal pages:

- `docs/index.html`
- `docs/privacy.html`
- `docs/terms.html`

Recommended public URLs:

- `https://a-network.net/`
- `https://a-network.net/privacy.html`
- `https://a-network.net/terms.html`

For the favicon to work, `logo.png` should be published in the same docs web root.

## Policy-Safe Messaging Guidelines

When preparing store listings, screenshots, ads, and marketing copy, keep messaging aligned with the real implementation.

Safe principles:

- Describe the app as a long-term ecosystem or session-based reward product
- Avoid promising profit, guaranteed income, or guaranteed token value
- Clearly separate off-chain app balance from on-chain wallet balance
- Keep privacy and terms URLs public and accessible
- Avoid unsupported tokenomics claims that do not exist in code

Avoid claiming:

- guaranteed returns
- guaranteed price growth
- financial services that are not implemented
- unsupported token allocations not present in code
- features that imply regulatory approval when none is shown in code or docs

## Legal Links

- Privacy Policy: `https://a-network.net/privacy.html`
- Terms of Service: `https://a-network.net/terms.html`

## Contact

- Email: `info@a-network.net`
- GitHub: `https://github.com/A-Network-2026`
- X: `https://x.com/AAlphaNetwork`

## Summary

A-Network currently ships as a real application stack with:

- code-backed off-chain mining logic
- code-backed network stats and leaderboard behavior
- code-backed on-chain ANET balance lookup
- public legal pages
- policy-safer product positioning for app store submission

Any future README updates should stay aligned with the actual source code, legal pages, and store-policy-safe language.
2. Build optimized release:
```bash
flutter build apk --release    # Android
flutter build ipa --release    # iOS
flutter build web --release    # Web
```



## 📝 Environment Variables

```env
PORT                - Server port (default: 3000)
DB_USER            - PostgreSQL username
DB_HOST            - Database host
DB_NAME            - Database name
DB_PASS            - Database password
DB_PORT            - Database port (default: 5432)
JWT_SECRET         - Secret key for JWT signing
```



## 🐛 Troubleshooting

### "Database connection error"
- Verify PostgreSQL is running
- Check .env credentials
- Ensure database exists: `createdb anetwork`

### "Mining failed: User not found"
- Register new account first
- Verify JWT token is valid

### "Already mining"
- Wait for current session to complete
- Or reset is_mining flag in database

### "Connection refused to API"
- Check backend server is running
- Verify correct API URL in `api.dart`
- For Android emulator, use machine IP instead of localhost

### Flutter video not loading
- Ensure `assets/video.mp4` exists
- Add to `pubspec.yaml` correctly
- Run `flutter pub get`



## 📈 Future Features

- [ ] Real blockchain integration
- [ ] Multiple mining pools
- [ ] Advanced analytics dashboard
- [ ] Social features (referrals, teams)
- [ ] Hardware acceleration support
- [ ] Mobile notification system
- [ ] WebSocket live updates
- [ ] Payment gateway integration



## 📄 License

ISC License

## 👨‍💻 Support

For issues or questions:
1. Check logs in backend console
2. Verify database schema
3. Test API endpoints with curl
4. Check Flutter console debug output

---

**⛏️ Happy Mining! 🚀**
