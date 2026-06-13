// Shared temp-password generator for onboarding flows.
// Used by admin-create-user and send-onboarding so the format stays identical.
//
// Format: Hager + 4 digits + 3 uppercase letters (e.g. "Hager4827KQM").
// No special characters and no easily-confused glyphs (0/O, 1/I) — easy to type
// on any mobile keyboard without autocorrect fights.
export function generateTempPassword(): string {
  const digits = '23456789'
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let d = ''
  for (let i = 0; i < 4; i++) d += digits[Math.floor(Math.random() * digits.length)]
  let u = ''
  for (let i = 0; i < 3; i++) u += uppers[Math.floor(Math.random() * uppers.length)]
  return `Hager${d}${u}`
}
