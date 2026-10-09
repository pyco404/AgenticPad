/** $AGP, AgenticPad's own token, launched on pump.fun through AgenticPad on 2026-10-09. */
export const AGP_MINT = process.env.NEXT_PUBLIC_AGP_MINT || "VTtPk5KG2FrHYXUwv7YvmRjxk66tuSutxvptFZAJAGP";
export const AGP_LINKS = {
  pump: `https://pump.fun/coin/${AGP_MINT}`,
  solscan: `https://solscan.io/token/${AGP_MINT}`,
  page: `/launch/${AGP_MINT}`,
};
