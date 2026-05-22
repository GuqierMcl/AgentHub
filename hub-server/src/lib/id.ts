import { nanoid } from 'nanoid'

const ID_LENGTH = 8

type IdPrefix = 'conv' | 'msg' | 'part' | 'run' | 'evt' | 'art' | 'ver' | 'pr'

const prefixes: Record<IdPrefix, string> = {
  conv: 'conv_',
  msg: 'msg_',
  part: 'part_',
  run: 'run_',
  evt: 'evt_',
  art: 'art_',
  ver: 'ver_',
  pr: 'pr_',
}

export function generateId(prefix: IdPrefix): string {
  return `${prefixes[prefix]}${nanoid(ID_LENGTH)}`
}