import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const gen = customAlphabet(alphabet, 16);

/** Prefixed ids make logs and URLs self-describing: pur_…, agt_…, usr_… */
export const newId = (prefix: "usr" | "pur" | "agt" | "pol" | "vlt" | "evt") => `${prefix}_${gen()}`;
