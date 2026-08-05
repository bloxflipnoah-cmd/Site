// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EMOJI_PATH = join(__dirname, '../../data/emoji.json');

export function getEmoji(name) {
  try {
    const data = JSON.parse(readFileSync(EMOJI_PATH, 'utf8'));
    return data[name] ?? '';
  } catch {
    return '';
  }
}

export function getAllEmojis() {
  try {
    return JSON.parse(readFileSync(EMOJI_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function setEmoji(name, emoji) {
  try {
    const data = JSON.parse(readFileSync(EMOJI_PATH, 'utf8'));
    data[name] = emoji;
    writeFileSync(EMOJI_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.
