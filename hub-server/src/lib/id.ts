import { nanoid } from "nanoid";

const ID_LENGTH = 8;

type IdPrefix =
  | "conv"
  | "msg"
  | "part"
  | "run"
  | "evt"
  | "art"
  | "ver"
  | "pr"
  | "mp"
  | "rpl"
  | "rpt"
  | "rrb"
  | "rtg"
  | "rt"
  | "rtc"
  | "eas"
  | "term";

const prefixes: Record<IdPrefix, string> = {
  conv: "conv_",
  msg: "msg_",
  part: "part_",
  run: "run_",
  evt: "evt_",
  art: "art_",
  ver: "ver_",
  pr: "pr_",
  mp: "mp_",
  rpl: "rpl_",
  rpt: "rpt_",
  rrb: "rrb_",
  rtg: "rtg_",
  rt: "rt_",
  rtc: "rtc_",
  term: "term_",
  eas: "eas_",
};

export function generateId(prefix: IdPrefix): string {
  return `${prefixes[prefix]}${nanoid(ID_LENGTH)}`;
}
