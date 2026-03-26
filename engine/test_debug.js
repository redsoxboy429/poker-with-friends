import { bestPLOHighHand, evaluate5CardHigh } from './src/evaluator.js';
import { parseCards, HandCategory } from './src/types.js';

const hole = parseCards('Jh Th 4c 5c');
const board = parseCards('Ah Kh Qh 2d 3d');
const result = bestPLOHighHand(hole, board);

console.log('Result category:', result.category, 'HandCategory.Flush =', HandCategory.Flush);
console.log('Result description:', result.description);
console.log('Result cards:', result.cards.map(c => `${c.rank}${c.suit}`).join(' '));

// Try manually checking combinations
const hand = parseCards('Jh Th Ah Kh Qh');
const manual = evaluate5CardHigh(hand);
console.log('\nManual Jh Th + Ah Kh Qh:');
console.log('  Category:', manual.category, 'HandCategory.Flush =', HandCategory.Flush);
console.log('  Description:', manual.description);
