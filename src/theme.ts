/** How the cavalry mode draws units, ground and effects (prototype styles besides classic). */
export type ArtStyle = 'classic' | 'ink' | 'rts' | '3d';

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

/** Prototype: classic pre-rendered RTS look — olive meadow, natural kit, strong team colours. */
export const RTS_THEME: Theme = {
  ...FIELD_THEME,
  artStyle: 'rts',
  blue: 0x2236e0, blueDark: 0x0e186e, red: 0xd01c14, redDark: 0x5c0a06,
  steel: 0xb8bcc2, steelDark: 0x4a4e56, wood: 0x8a6038, leather: 0x6a4626, trim: 0xe8dcc0,
  grassDark: 0x98aa4e, grassLight: 0xc6ca72, grassDry: 0xd6c47e, dirt: 0xa88c5c,
};

/** Prototype: real-time 3D battlefield (the charge mode only; tactics uses the field look). */
export const THREE_D_THEME: Theme = { ...FIELD_THEME, artStyle: '3d' };

/** The styles on offer. (DAY_THEME and FIELD_THEME are the palettes the others build on.) */
export type ThemeName = 'ink' | 'rts' | '3d';

export const THEMES: Record<ThemeName, Theme> = {
  ink: INK_THEME,
  rts: RTS_THEME,
  '3d': THREE_D_THEME,
};
