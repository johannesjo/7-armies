/** How the cavalry mode draws units, ground and effects (prototype styles besides classic). */
export type ArtStyle = 'classic' | 'mini' | 'ink' | 'rts' | '3d';

export interface Theme {
  /** Cavalry-mode art style (default classic). */
  artStyle?: ArtStyle;
  bg: number;
  grid: number;
  gridAlpha: number;

  // Elevation zones
  elevationOuter: number;
  elevationMid: number;
  elevationInner: number;
  elevationLabel: string;

  // Obstacles
  obstacleBorder: number;
  obstacleFill: number;
  obstacleHighlight: number;

  // Teams
  blue: number;
  blueDark: number;
  red: number;
  redDark: number;

  // Effects — projectile
  blueProjectile: number;
  redProjectile: number;

  // Blood colors
  blueBlood: number[];
  redBlood: number[];
  blueStain: number;
  redStain: number;

  // Muzzle flash (bow release)
  muzzleFlash: number;
  muzzleCore: number;

  // Barrel / weapon indicator
  barrel: number;
  barrelAlpha: number;

  // Unit materials
  steel: number;
  steelDark: number;
  wood: number;
  leather: number;
  /** Light accent for trims, fletching and bowstrings. */
  trim: number;

  // Ground
  /** Paint a realistic grass field instead of a flat background. */
  grass: boolean;
  grassDark: number;
  grassLight: number;
  grassDry: number;
  /** Bare / trampled earth, hoofprints. */
  dirt: number;
  /** Outline behind floating combat text. */
  textOutline: number;

  // HP bar
  hpBg: number;
  hpHigh: number;
  hpMid: number;
  hpLow: number;

  // Path drawer
  bluePath: number;
  redPath: number;
  bluePathBright: number;
  redPathBright: number;
  labelFill: number;
  labelWarn: number;
  elevationBonus: number;
  hoverLabelFill: number;

  // Paper aesthetic
  paperNoise: boolean;
  sketchyObstacles: boolean;
  bloodAlpha: number;
  bloodFade: number;
  elevationAlpha: number;
}

export const NIGHT_THEME: Theme = {
  bg: 0x1a1a2e,
  grid: 0x1a1a2e,
  gridAlpha: 0,

  elevationOuter: 0x2e2e48,
  elevationMid: 0x333358,
  elevationInner: 0x3a3a68,
  elevationLabel: '#66ff88',

  obstacleBorder: 0x8888aa,
  obstacleFill: 0x4a4a6e,
  obstacleHighlight: 0x9999bb,

  blue: 0x4a9eff,
  blueDark: 0x2a5a8a,
  red: 0xff4a4a,
  redDark: 0x8a2a2a,

  blueProjectile: 0x88ccff,
  redProjectile: 0xff8888,

  blueBlood: [0x3377dd, 0x2255bb, 0x5599ee],
  redBlood: [0xdd3333, 0xbb2222, 0xee4444],
  blueStain: 0x1a3366,
  redStain: 0x661a1a,

  muzzleFlash: 0xffffaa,
  muzzleCore: 0xffffff,

  barrel: 0xffffff,
  barrelAlpha: 0.6,

  steel: 0xbdbab4,
  steelDark: 0x6c6964,
  wood: 0x8a7c6a,
  leather: 0x5e5246,
  trim: 0xf2ead8,

  grass: false,
  grassDark: 0x1a1a2e,
  grassLight: 0x1a1a2e,
  grassDry: 0x1a1a2e,
  dirt: 0x6a6a90,
  textOutline: 0x1a1a2e,

  hpBg: 0x333333,
  hpHigh: 0x44ff44,
  hpMid: 0xffaa00,
  hpLow: 0xff4444,

  bluePath: 0x4a9eff,
  redPath: 0xff4a4a,
  bluePathBright: 0x8ac4ff,
  redPathBright: 0xff8a8a,
  labelFill: 0xffffff,
  labelWarn: 0xff4444,
  elevationBonus: 0x66ff88,
  hoverLabelFill: 0xffffff,
  paperNoise: false,
  sketchyObstacles: false,
  bloodAlpha: 1,
  bloodFade: 0.6,
  elevationAlpha: 1,
};

export const DAY_THEME: Theme = {
  bg: 0xf5f0e0,
  grid: 0xf5f0e0,
  gridAlpha: 0,

  elevationOuter: 0xc0b890,
  elevationMid: 0xb0a878,
  elevationInner: 0xa09868,
  elevationLabel: '#558844',

  obstacleBorder: 0x665544,
  obstacleFill: 0xddd4c0,
  obstacleHighlight: 0xbbaa88,

  blue: 0x2266aa,
  blueDark: 0x143d66,
  red: 0xaa3333,
  redDark: 0x661a1a,

  blueProjectile: 0x4488cc,
  redProjectile: 0xcc5555,

  blueBlood: [0x3388dd, 0x2266bb, 0x55aaee],
  redBlood: [0xcc4433, 0xaa2222, 0xdd6644],
  blueStain: 0x2266aa,
  redStain: 0xaa3322,

  muzzleFlash: 0xddcc88,
  muzzleCore: 0xeee8cc,

  barrel: 0x443322,
  barrelAlpha: 0.7,

  steel: 0x9e9a93,
  steelDark: 0x5c5853,
  wood: 0x7a6c5a,
  leather: 0x5c5044,
  trim: 0xf7f1e1,

  grass: false,
  grassDark: 0xf5f0e0,
  grassLight: 0xf5f0e0,
  grassDry: 0xf5f0e0,
  dirt: 0x665544,
  textOutline: 0xf5f0e0,

  hpBg: 0x998877,
  hpHigh: 0x448833,
  hpMid: 0xbb8822,
  hpLow: 0xaa4433,

  bluePath: 0x2266aa,
  redPath: 0xaa3333,
  bluePathBright: 0x4488cc,
  redPathBright: 0xcc5555,
  labelFill: 0x443322,
  labelWarn: 0xaa3333,
  elevationBonus: 0x558844,
  hoverLabelFill: 0x443322,
  paperNoise: true,
  sketchyObstacles: true,
  bloodAlpha: 0.85,
  bloodFade: 0.9,
  elevationAlpha: 0.6,
};

/** Realistic field: grass, earthy team colours, darker blood. */
export const FIELD_THEME: Theme = {
  bg: 0x5c7539,
  grid: 0x5c7539,
  gridAlpha: 0,

  elevationOuter: 0x86a04e,
  elevationMid: 0x93ab58,
  elevationInner: 0xa1b764,
  elevationLabel: '#f4e9a8',

  obstacleBorder: 0x4b4636,
  obstacleFill: 0x8a8577,
  obstacleHighlight: 0xa8a394,

  blue: 0x2f5fa0,
  blueDark: 0x1a3863,
  red: 0xb0342b,
  redDark: 0x611914,

  blueProjectile: 0xe2e8ef,
  redProjectile: 0xf1e2dc,

  blueBlood: [0x8a1a16, 0x6e1410, 0xa02a20],
  redBlood: [0x8a1a16, 0x6e1410, 0xa02a20],
  blueStain: 0x4a120d,
  redStain: 0x4a120d,

  muzzleFlash: 0xf2ead0,
  muzzleCore: 0xffffff,

  barrel: 0x2b2a20,
  barrelAlpha: 0.7,

  hpBg: 0x2e3320,
  hpHigh: 0x9fd05a,
  hpMid: 0xe6b03a,
  hpLow: 0xd8502e,

  bluePath: 0x2f5fa0,
  redPath: 0xb0342b,
  bluePathBright: 0x7aa6e0,
  redPathBright: 0xe07a6e,
  labelFill: 0x262a1a,
  labelWarn: 0xd8402e,
  elevationBonus: 0xf2d35a,
  hoverLabelFill: 0xf4f0e0,
  paperNoise: false,
  sketchyObstacles: false,
  bloodAlpha: 0.9,
  bloodFade: 0.5,
  elevationAlpha: 0.7,

  steel: 0xb3b1ab,
  steelDark: 0x5f5d58,
  wood: 0x8a7558,
  leather: 0x5e4a36,
  trim: 0xefe7d2,

  grass: true,
  grassDark: 0x4a6330,
  grassLight: 0x76904b,
  grassDry: 0x9c9562,
  dirt: 0x6e5a40,
  textOutline: 0x1c2412,
};

/** Prototype: painted tabletop miniatures on a felt table. */
export const MINI_THEME: Theme = {
  ...FIELD_THEME,
  artStyle: 'mini',
  blue: 0x2a5bc4, blueDark: 0x13306f, red: 0xc42a1f, redDark: 0x6a120c,
  steel: 0xc8c8c4, steelDark: 0x55534e, wood: 0x9a7448, trim: 0xf4ecd6,
  grassDark: 0x3d6230, grassLight: 0x5a8240, grassDry: 0x8e9450, dirt: 0xa88f60,
  // No gore on the table: knocks chip paint and scuff the felt.
  blueBlood: [0x3a3226, 0x5a4a36, 0x2a241c], redBlood: [0x3a3226, 0x5a4a36, 0x2a241c],
  blueStain: 0x3a3424, redStain: 0x3a3424, bloodAlpha: 0.6, bloodFade: 0.3,
};

/** Prototype: ink and watercolour on paper. */
export const INK_THEME: Theme = {
  ...DAY_THEME,
  artStyle: 'ink',
  grass: true,
  bg: 0xefe5ca,
  blue: 0x2c5596, blueDark: 0x1a3460, red: 0xb03a2c, redDark: 0x6a1e16,
  grassDark: 0xa9b783, grassLight: 0xd6d6a6, grassDry: 0xddcb9c, dirt: 0xb39a72,
  obstacleFill: 0xb8ab90, wood: 0x6a5238, steel: 0x6a6660, steelDark: 0x2a2620, trim: 0xf6efdc,
  blueBlood: [0xa8322a, 0x8a2a22, 0xc0453a], redBlood: [0xa8322a, 0x8a2a22, 0xc0453a],
  blueStain: 0x8a2a22, redStain: 0x8a2a22, bloodAlpha: 0.55, bloodFade: 0.6,
  textOutline: 0xefe5ca,
};

/** Prototype: classic painted-RTS look — vivid, chunky, sunlit. */
export const RTS_THEME: Theme = {
  ...FIELD_THEME,
  artStyle: 'rts',
  blue: 0x1f55e0, blueDark: 0x0d2a80, red: 0xd8261c, redDark: 0x7a0f0b,
  steel: 0xd8d8de, steelDark: 0x55555e, wood: 0x9a6a38, leather: 0x7a5030, trim: 0xfff2c4,
  grassDark: 0x3d7a22, grassLight: 0x86b84a, grassDry: 0xc0b25e, dirt: 0xa07848,
};

/** Prototype: real-time 3D battlefield (the charge mode only; tactics uses the field look). */
export const THREE_D_THEME: Theme = { ...FIELD_THEME, artStyle: '3d' };

export type ThemeName = 'field' | 'parchment' | 'night' | 'mini' | 'ink' | 'rts' | '3d';

export const THEMES: Record<ThemeName, Theme> = {
  field: FIELD_THEME,
  parchment: DAY_THEME,
  night: NIGHT_THEME,
  mini: MINI_THEME,
  ink: INK_THEME,
  rts: RTS_THEME,
  '3d': THREE_D_THEME,
};
