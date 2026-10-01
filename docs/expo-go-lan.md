# Expo Go against the LAN API

The phone and development machine must be on the same Wi-Fi network. The API must bind
to `0.0.0.0`, while Expo and the app use the machine's LAN address. `localhost` on the
phone refers to the phone itself.

1. Find the machine's LAN address (`ipconfig getifaddr en0` on macOS).
2. Copy `mobile/.env.example` to the ignored `mobile/.env.local` and set:

   ```dotenv
   EXPO_PUBLIC_TARDY_WEB_URL=http://<lan-ip>:4173
   EXPO_PUBLIC_TARDY_API_URL=http://<lan-ip>:3300
   ```

3. Start PostgreSQL 17 and the API using the normal development stack. Confirm the
   phone-reachable endpoint with `curl http://<lan-ip>:3300/healthz`.
4. From `mobile/`, run `npm ci` and `npx expo start --lan --clear`.
5. Press `s` if Expo starts in development-build mode, then scan the Expo Go QR code.

The presence of `EXPO_PUBLIC_TARDY_API_URL` selects `HttpTardyApi`. Removing it restores
the explicit in-app mock backend. Never commit `.env.local`; LAN addresses are local
machine state.
