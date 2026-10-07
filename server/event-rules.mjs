export const STARTERS = [
  { id: "ARDUINO_UNO", name: "Arduino Uno", quantity: 1 },
  { id: "CAR_CHASSIS", name: "Chassis / Frame", quantity: 1 },
  { id: "WHEELS_TYRES", name: "Wheel", quantity: 2 },
  { id: "BALL_CASTER", name: "Caster Wheel", quantity: 1 },
];
export const MARKET = [
  { id: "DC_GEARED_MOTOR", name: "DC Geared Motor", quantity: 16, price: 100 },
  { id: "L298D_DRIVER", name: "Motor Driver", quantity: 8, price: 120 },
  { id: "BATTERY", name: "Battery / Power Source", quantity: 8, price: 100 },
  {
    id: "ULTRASONIC",
    name: "HC-SR04 Ultrasonic Sensor",
    quantity: 3,
    price: 100,
  },
  { id: "IR_SENSOR", name: "IR Line Sensor", quantity: 4, price: 60 },
  { id: "LDR", name: "LDR / Light Sensor", quantity: 2, price: 30 },
  { id: "HC05", name: "HC-05 Bluetooth Module", quantity: 1, price: 150 },
  {
    id: "SOUND_SENSOR",
    name: "Sound / Microphone Sensor",
    quantity: 1,
    price: 80,
  },
  { id: "SERVO_MOTOR", name: "Servo Motor", quantity: 1, price: 100 },
];
const drive = { L298D_DRIVER: 1, DC_GEARED_MOTOR: 2, BATTERY: 1 };
export const PROJECTS = [
  {
    name: "Obstacle Avoidance Robot",
    teams: 2,
    requirements: { ...drive, ULTRASONIC: 1 },
  },
  {
    name: "Line Follower Robot",
    teams: 2,
    requirements: { ...drive, IR_SENSOR: 2 },
  },
  {
    name: "Light Follower Robot",
    teams: 1,
    requirements: { ...drive, LDR: 2 },
  },
  {
    name: "Bluetooth Controlled Car",
    teams: 1,
    requirements: { ...drive, HC05: 1 },
  },
  {
    name: "Clap Detector Robot",
    teams: 1,
    requirements: { ...drive, SOUND_SENSOR: 1 },
  },
  {
    name: "Radar Car",
    teams: 1,
    requirements: { ...drive, ULTRASONIC: 1, SERVO_MOTOR: 1 },
  },
];
export const FINAL_CONFIG = {
  eventName: "ROBOTS OF THE BACKSTREET",
  organizer:
    "IEEE Robotics & Automation Society — Ahmedabad University Student Branch",
  venue: "GICT 105, Ahmedabad University",
  eventDate: "2026-10-07",
  startTime: "15:00",
  endTime: "16:30",
  durationMinutes: 90,
  initialBolts: 1000,
  teamLimit: 8,
  participants: 40,
  teamSize: 5,
  allocationConfirmed: true,
  rulesConfirmed: true,
  starterAllocationEnabled: true,
  enforceProjectPurchases: true,
  allowItemTrading: true,
  allowItemForItem: true,
  allowItemForBolts: true,
  allowMixedTrades: true,
  allowBoltTransfer: true,
  allowRefunds: false,
  allowNegativeBalance: false,
  allowNegativeStock: false,
  postEventEditing: false,
  maximumPurchaseQuantity: null,
};
export function isMarket(component) {
  return (
    component.status === "Active" &&
    !["Starter", "Common", "Reference"].includes(component.category)
  );
}
export function canTrade(component) {
  return (
    component.status === "Active" &&
    !["Common", "Reference"].includes(component.category)
  );
}
