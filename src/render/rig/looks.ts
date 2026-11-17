/**
 * Proportions and colourways of the five original fighters.
 *
 * Lengths are in logical pixels for a scale-1 fighter (~185 tall); the rig
 * multiplies them by the character's `scale` from the simulation data.
 */
import { PAL } from '../palette';
import type { CharId } from '../../sim/types';

export interface Proportions {
  /** Pelvis to neck. */
  torso: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  /** Head radius. */
  head: number;
  /** Half width of the shoulders / hips as seen from the side. */
  shoulder: number;
  hip: number;
  /** Limb thickness at the root. */
  armW: number;
  legW: number;
  /** Size of fists and feet. */
  fist: number;
  foot: number;
  neck: number;
}

export type HairStyle = 'fringe' | 'shaved' | 'ponytail' | 'beanie' | 'cap';
export type TopStyle = 'windbreaker' | 'vest' | 'track' | 'tank' | 'waistcoat';
export type LegStyle = 'joggers' | 'shorts' | 'track' | 'sweats' | 'trousers';

export interface Colourway {
  skin: string;
  skinShade: string;
  hair: string;
  top: string;
  topShade: string;
  /** Stripe, collar, trim. */
  trim: string;
  legs: string;
  legsShade: string;
  /** Wraps / gloves. */
  hands: string;
  shoes: string;
  /** UI accent for this colourway. */
  accent: string;
  accentDim: string;
}

export interface Look {
  prop: Proportions;
  hair: HairStyle;
  top: TopStyle;
  legs: LegStyle;
  /** Bare arms (sleeveless top) rather than sleeves. */
  bareArms: boolean;
  beard: boolean;
  /** Shin guards / knee pads drawn over the lower leg. */
  shinGuards: boolean;
  skins: [Colourway, Colourway, Colourway];
}

export const OUTLINE = '#05060b';

const BASE: Proportions = {
  torso: 58,
  upperArm: 31,
  foreArm: 30,
  thigh: 43,
  shin: 43,
  head: 15,
  shoulder: 16.5,
  hip: 13.5,
  armW: 15,
  legW: 21,
  fist: 9.5,
  foot: 14,
  neck: 7,
};

export const LOOKS: Record<CharId, Look> = {
  kestrel: {
    prop: { ...BASE, torso: 55, shoulder: 15, hip: 12.5, armW: 13, legW: 18.5, head: 15, thigh: 44, shin: 44, fist: 9 },
    hair: 'fringe',
    top: 'windbreaker',
    legs: 'joggers',
    bareArms: false,
    beard: false,
    shinGuards: false,
    skins: [
      {
        skin: '#d9a57c', skinShade: '#a8734f', hair: '#e2703a',
        top: '#2aa79c', topShade: '#176e6b', trim: PAL.bone100,
        legs: '#2b3040', legsShade: '#191d2a', hands: '#ece6d6', shoes: '#e9e4d6',
        accent: PAL.cyan, accentDim: PAL.cyanDim,
      },
      {
        skin: '#c98f66', skinShade: '#93603f', hair: '#2d2f3a',
        top: '#d3b33c', topShade: '#8f7620', trim: '#1c2235',
        legs: '#3a2f45', legsShade: '#231b2c', hands: '#1c2235', shoes: '#c9c3b4',
        accent: PAL.hazard, accentDim: '#8f7620',
      },
      {
        skin: '#e1b490', skinShade: '#ad8060', hair: '#d9d3c4',
        top: '#c9455f', topShade: '#7d2439', trim: '#f0c9a0',
        legs: '#22283a', legsShade: '#141826', hands: '#f0c9a0', shoes: '#2a324b',
        accent: PAL.red, accentDim: PAL.redDim,
      },
    ],
  },
  anvil: {
    prop: { ...BASE, torso: 60, shoulder: 23, hip: 16.5, armW: 21.5, legW: 25, upperArm: 32, foreArm: 30, head: 15.5, fist: 12.5, foot: 16, thigh: 41, shin: 41, neck: 5 },
    hair: 'shaved',
    top: 'vest',
    legs: 'shorts',
    bareArms: true,
    beard: true,
    shinGuards: false,
    skins: [
      {
        skin: '#7a4a2f', skinShade: '#4f2d1b', hair: '#1a1210',
        top: '#d0752a', topShade: '#8a4517', trim: '#f4a63a',
        legs: '#2a2d36', legsShade: '#181a21', hands: '#15161c', shoes: '#23252e',
        accent: PAL.amber, accentDim: PAL.amberDim,
      },
      {
        skin: '#8a5a3c', skinShade: '#5a3622', hair: '#20191a',
        top: '#3f6fb0', topShade: '#27457a', trim: '#a7afc6',
        legs: '#1c2235', legsShade: '#10131c', hands: '#ece6d6', shoes: '#2a324b',
        accent: '#5d8fd6', accentDim: '#27457a',
      },
      {
        skin: '#6b4029', skinShade: '#432617', hair: '#151010',
        top: '#5a6b3a', topShade: '#374423', trim: PAL.hazard,
        legs: '#3a3327', legsShade: '#231f17', hands: '#e6c13c', shoes: '#1c1a16',
        accent: '#9db35a', accentDim: '#4d5c2c',
      },
    ],
  },
  switch: {
    prop: { ...BASE, torso: 57 },
    hair: 'ponytail',
    top: 'track',
    legs: 'track',
    bareArms: false,
    beard: false,
    shinGuards: false,
    skins: [
      {
        skin: '#c68a5e', skinShade: '#925d3b', hair: '#1c1620',
        top: '#d2384f', topShade: '#8a1f33', trim: PAL.bone100,
        legs: '#15171f', legsShade: '#0a0b10', hands: '#15171f', shoes: '#ece6d6',
        accent: PAL.red, accentDim: PAL.redDim,
      },
      {
        skin: '#d3a077', skinShade: '#9d6e4b', hair: '#5a2f1c',
        top: '#2d8f6a', topShade: '#195a42', trim: '#e6c13c',
        legs: '#1b2430', legsShade: '#0f151d', hands: '#e6c13c', shoes: '#d9d3c4',
        accent: '#4fc79a', accentDim: '#1f6b50',
      },
      {
        skin: '#b97c52', skinShade: '#855233', hair: '#d8d2c2',
        top: '#3d4fb0', topShade: '#243074', trim: '#f4a63a',
        legs: '#22222c', legsShade: '#131319', hands: '#f4a63a', shoes: '#f4a63a',
        accent: '#6f82ea', accentDim: '#2c3a8a',
      },
    ],
  },
  pylon: {
    prop: { ...BASE, torso: 55, shoulder: 15.5, hip: 12, armW: 12.5, legW: 17, upperArm: 33, foreArm: 33, thigh: 47, shin: 47, head: 14.5, fist: 9, foot: 14, neck: 9 },
    hair: 'beanie',
    top: 'tank',
    legs: 'sweats',
    bareArms: true,
    beard: false,
    shinGuards: true,
    skins: [
      {
        skin: '#e8c3a4', skinShade: '#b48a6c', hair: '#5a43b8',
        top: '#7d5fe0', topShade: '#4a3691', trim: PAL.bone100,
        legs: '#b9bcc8', legsShade: '#7d8194', hands: '#7d5fe0', shoes: '#2a324b',
        accent: PAL.violet, accentDim: PAL.violetDim,
      },
      {
        skin: '#dfb694', skinShade: '#aa7f5e', hair: '#c9452f',
        top: '#23262f', topShade: '#12141a', trim: '#f2475f',
        legs: '#8d3a2c', legsShade: '#5a221a', hands: '#ece6d6', shoes: '#15171f',
        accent: '#f07a4a', accentDim: '#8d3a2c',
      },
      {
        skin: '#c99a78', skinShade: '#946a4c', hair: '#1d7f7b',
        top: '#d9d3c4', topShade: '#9a9484', trim: '#1d7f7b',
        legs: '#263a3d', legsShade: '#152224', hands: '#3cd8c8', shoes: '#ece6d6',
        accent: PAL.cyan, accentDim: PAL.cyanDim,
      },
    ],
  },
  conductor: {
    prop: { ...BASE, torso: 61, shoulder: 20, hip: 15, armW: 17, legW: 22.5, upperArm: 33, foreArm: 32, thigh: 45, shin: 45, head: 15.5, fist: 11, foot: 15.5, neck: 7 },
    hair: 'cap',
    top: 'waistcoat',
    legs: 'trousers',
    bareArms: false,
    beard: true,
    shinGuards: false,
    skins: [
      {
        skin: '#c79872', skinShade: '#906846', hair: '#9aa0b4',
        top: '#ece6d6', topShade: '#aaa391', trim: '#d8b45a',
        legs: '#14161d', legsShade: '#090a0e', hands: '#14161d', shoes: '#0c0d12',
        accent: '#d8b45a', accentDim: '#8a6f2c',
      },
      {
        skin: '#b98a66', skinShade: '#845c3f', hair: '#d9d3c4',
        top: '#3a2030', topShade: '#22121c', trim: '#f2475f',
        legs: '#191a22', legsShade: '#0c0d12', hands: '#f2475f', shoes: '#0c0d12',
        accent: PAL.red, accentDim: PAL.redDim,
      },
      {
        skin: '#d1a47f', skinShade: '#9b7253', hair: '#2a324b',
        top: '#1d3a4a', topShade: '#11222c', trim: '#3cd8c8',
        legs: '#10131c', legsShade: '#07090f', hands: '#3cd8c8', shoes: '#07090f',
        accent: PAL.cyan, accentDim: PAL.cyanDim,
      },
    ],
  },
};

export const SKIN_COUNT = 3;

export function colourway(char: CharId, skin: number): Colourway {
  const look = LOOKS[char] ?? LOOKS.switch;
  const i = ((Math.floor(skin) % SKIN_COUNT) + SKIN_COUNT) % SKIN_COUNT;
  return look.skins[i] as Colourway;
}
