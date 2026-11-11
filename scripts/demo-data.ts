/**
 * The demo marketplace: one store ("MandatePay Market") with five seller brands, 25 products, and a small team.
 * Pictures are free-licence photos from Pexels (https://www.pexels.com/license/): linked, not copied. Each id below was
 * checked to load. Credits are in docs/DEMO_DATA.md.
 */
import type { ProductInput } from '../contracts/schemas';

export const STORE_NAME = 'MandatePay Market';
export const SUPPORT_EMAIL = 'help@mandatepay.demo';

const pexels = (id: number) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=800`;

type P = Omit<ProductInput, 'currency' | 'image_url'> & { photo: number };

const STRIDE = 'Stride Lab';
const LOOM = 'Loomhouse';
const FIELD = 'Fieldnote';
const BRIGHT = 'Brightwire';
const TIDE = 'Tidewater';

const catalog: P[] = [
  // Stride Lab: running shoes (the demo mandate "white running trainers, size 10, under 110" lands here)
  { sku: 'AR-WHT-10', name: 'Aero Runner', description: 'A light everyday running trainer with a cushioned midsole.', category: 'trainers', unit_price: '89.00', attributes: { color: 'white', size: '10' }, stock: 12, delivery_days: 4, seller: STRIDE, photo: 1461048 },
  { sku: 'AR-WHT-9', name: 'Aero Runner', description: 'A light everyday running trainer with a cushioned midsole.', category: 'trainers', unit_price: '89.00', attributes: { color: 'white', size: '9' }, stock: 6, delivery_days: 4, seller: STRIDE, photo: 1461048 },
  { sku: 'AR-BLK-10', name: 'Aero Runner', description: 'The same light trainer in black.', category: 'trainers', unit_price: '84.00', attributes: { color: 'black', size: '10' }, stock: 8, delivery_days: 3, seller: STRIDE, photo: 18202570 },
  { sku: 'AP-WHT-10', name: 'Aero Pro Racer', description: 'A lightweight racing shoe for race day.', category: 'trainers', unit_price: '149.00', attributes: { color: 'white', size: '10' }, stock: 4, delivery_days: 6, seller: STRIDE, photo: 6050912 },
  { sku: 'TR-WHT-10', name: 'Trail Grip', description: 'A grippy trainer for dirt paths and wet days.', category: 'trainers', unit_price: '104.00', attributes: { color: 'white', size: '10' }, stock: 7, delivery_days: 5, seller: STRIDE, photo: 1456705 },

  // Loomhouse: knitwear and basics
  { sku: 'LH-SWT-GRY-M', name: 'Merino Crew Sweater', description: 'A fine merino crew neck that layers easily.', category: 'clothing', unit_price: '78.00', attributes: { color: 'grey', size: 'M' }, stock: 10, delivery_days: 4, seller: LOOM, photo: 5603269 },
  { sku: 'LH-SWT-NVY-L', name: 'Merino Crew Sweater', description: 'A fine merino crew neck that layers easily.', category: 'clothing', unit_price: '78.00', attributes: { color: 'navy', size: 'L' }, stock: 9, delivery_days: 4, seller: LOOM, photo: 5464589 },
  { sku: 'LH-TEE-WHT-M', name: 'Organic Cotton Tee', description: 'A plain, heavyweight tee in organic cotton.', category: 'clothing', unit_price: '24.00', attributes: { color: 'white', size: 'M' }, stock: 30, delivery_days: 3, seller: LOOM, photo: 5746087 },
  { sku: 'LH-VNK-WHT-L', name: 'Pima V-Neck Tee', description: 'A soft pima cotton v-neck.', category: 'clothing', unit_price: '29.00', attributes: { color: 'white', size: 'L' }, stock: 22, delivery_days: 3, seller: LOOM, photo: 7432216 },
  { sku: 'LH-CRD-OAT-M', name: 'Chunky Knit Cardigan', description: 'A roomy cardigan in an oat wool blend.', category: 'clothing', unit_price: '96.00', attributes: { color: 'oat', size: 'M' }, stock: 5, delivery_days: 5, seller: LOOM, photo: 14641440 },

  // Fieldnote: stationery and bags
  { sku: 'FN-NB-A5', name: 'Dot Grid Notebook', description: 'A5 notebook with 160 pages of dot grid paper.', category: 'stationery', unit_price: '16.00', attributes: { size: 'A5', paper: 'dot grid' }, stock: 40, delivery_days: 3, seller: FIELD, photo: 7598077 },
  { sku: 'FN-BAG-OLV', name: 'Canvas Daypack', description: 'A waxed canvas daypack with a padded laptop pocket.', category: 'bags', unit_price: '58.00', attributes: { color: 'olive' }, stock: 11, delivery_days: 5, seller: FIELD, photo: 2081199 },
  { sku: 'FN-CARD-TAN', name: 'Leather Card Holder', description: 'A slim vegetable-tanned leather card holder.', category: 'accessories', unit_price: '32.00', attributes: { color: 'tan' }, stock: 18, delivery_days: 4, seller: FIELD, photo: 4452399 },
  { sku: 'FN-PEN-BLK', name: 'Desk Pen Set', description: 'Three smooth-writing pens in black.', category: 'stationery', unit_price: '18.00', attributes: { color: 'black' }, stock: 35, delivery_days: 3, seller: FIELD, photo: 5594336 },
  { sku: 'FN-TOTE-NAT', name: 'Everyday Tote', description: 'A sturdy natural canvas tote with an inside pocket.', category: 'bags', unit_price: '26.00', attributes: { color: 'natural' }, stock: 20, delivery_days: 4, seller: FIELD, photo: 8148587 },

  // Brightwire: everyday electronics
  { sku: 'BW-USBC-2M', name: 'Braided USB-C Cable', description: 'A 2 m braided cable for charging and data.', category: 'electronics', unit_price: '15.00', attributes: { color: 'black', length: '2 m' }, stock: 50, delivery_days: 2, seller: BRIGHT, photo: 3921713 },
  { sku: 'BW-GAN-65', name: '65 W GaN Charger', description: 'A compact charger for a laptop and a phone at once.', category: 'electronics', unit_price: '39.00', attributes: { color: 'white', power: '65 W' }, stock: 24, delivery_days: 3, seller: BRIGHT, photo: 3921630 },
  { sku: 'BW-EARB-WHT', name: 'Wireless Earbuds', description: 'Earbuds with a charging case and eight hours of playback.', category: 'electronics', unit_price: '59.00', attributes: { color: 'white' }, stock: 16, delivery_days: 4, seller: BRIGHT, photo: 11599423 },
  { sku: 'BW-STAND-ALU', name: 'Aluminium Laptop Stand', description: 'A folding stand that lifts a laptop to eye level.', category: 'electronics', unit_price: '45.00', attributes: { color: 'silver' }, stock: 14, delivery_days: 4, seller: BRIGHT, photo: 4792712 },
  { sku: 'BW-PB-10K', name: 'Power Bank 10,000 mAh', description: 'A pocket power bank with two ports.', category: 'electronics', unit_price: '34.00', attributes: { color: 'white', capacity: '10,000 mAh' }, stock: 28, delivery_days: 3, seller: BRIGHT, photo: 4072683 },

  // Tidewater: home and outdoors
  { sku: 'TW-BTL-750', name: 'Insulated Bottle', description: 'Keeps drinks cold for a day and hot for twelve hours.', category: 'home', unit_price: '29.00', attributes: { color: 'steel', size: '750 ml' }, stock: 26, delivery_days: 4, seller: TIDE, photo: 3737800 },
  { sku: 'TW-MUG-SAGE', name: 'Stoneware Mug Set', description: 'Two hand-glazed stoneware mugs in sage.', category: 'home', unit_price: '30.00', attributes: { color: 'sage', pieces: '2' }, stock: 15, delivery_days: 5, seller: TIDE, photo: 4466240 },
  { sku: 'TW-BOWL-2', name: 'Stoneware Bowl Set', description: 'Two deep stoneware bowls in cream.', category: 'home', unit_price: '36.00', attributes: { color: 'cream', pieces: '2' }, stock: 12, delivery_days: 5, seller: TIDE, photo: 2417857 },
  { sku: 'TW-PLNT-TC', name: 'Terracotta Planter', description: 'A classic terracotta planter with a drainage hole.', category: 'home', unit_price: '21.00', attributes: { color: 'terracotta' }, stock: 25, delivery_days: 4, seller: TIDE, photo: 9707245 },
  { sku: 'TW-CNDL-LIN', name: 'Beeswax Candle', description: 'A slow-burning beeswax candle in a linen wrap.', category: 'home', unit_price: '19.00', attributes: { color: 'linen' }, stock: 32, delivery_days: 3, seller: TIDE, photo: 10610004 },
];

export const PRODUCTS: ProductInput[] = catalog.map(({ photo, ...p }) => ({ ...p, currency: 'USD', image_url: pexels(photo) }));

export interface DemoAccount {
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'buyer';
}

/** The store team and a shopper. Two more shoppers sign in with PayPal themselves, so they are not listed here. */
export const ACCOUNTS: DemoAccount[] = [
  { email: 'maya.chen@mandatepay.demo', name: 'Maya Chen', role: 'admin' },
  { email: 'jordan.ellis@mandatepay.demo', name: 'Jordan Ellis', role: 'staff' },
  { email: 'priya.nair@mandatepay.demo', name: 'Priya Nair', role: 'staff' },
  { email: 'tom.becker@mandatepay.demo', name: 'Tom Becker', role: 'staff' },
  { email: 'sam.rivera@mandatepay.demo', name: 'Sam Rivera', role: 'buyer' },
];
