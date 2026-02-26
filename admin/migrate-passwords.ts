import { hashPassword, isBcryptHash } from "../lib/auth/password";
import { readUsersFromSheet, updateUserPasswordCell } from "../lib/google/sheets";

async function main() {
  const users = await readUsersFromSheet();
  let migrated = 0;

  for (const user of users) {
    if (!user.password || isBcryptHash(user.password)) continue;
    const hash = await hashPassword(user.password);
    await updateUserPasswordCell(user.rowNumber, user.passwordColumn, hash);
    migrated += 1;
    console.log(`Migrated: ${user.username}`);
  }

  console.log(`Done. Passwords migrated: ${migrated}`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
