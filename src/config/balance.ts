/**
 * Gameplay tuning numbers. Movement values are in metres and seconds.
 */
export const PLAYER = {
  radius: 0.35,
  /** Capsule half-height (cylinder part) standing. Total height = 2*(h+r). */
  halfHeight: 0.55,
  crouchHalfHeight: 0.18,
  eyeHeightStanding: 1.65,
  eyeHeightCrouching: 1.0,
  mass: 80,
  walkSpeed: 4.6,
  sprintSpeed: 8.2,
  crouchSpeed: 2.2,
  groundAccel: 55,
  airAccel: 9,
  groundFriction: 12,
  /** Gravity multiplier for the player, for a snappier (still natural) arc. */
  gravityScale: 1.55,
  jumpHeight: 1.25,
  /** Grace time after leaving a ledge where a jump is still allowed. */
  coyoteTime: 0.12,
  /** A jump pressed this long before landing still fires. */
  jumpBuffer: 0.14,
  maxSlopeClimbDeg: 46,
  minSlopeSlideDeg: 52,
  stepHeight: 0.42,
  stepMinWidth: 0.18,
  snapToGround: 0.35,
  maxEnergy: 100,
  energyRegen: 14,
  energyRegenDelay: 0.8,
};

export const CAMERA = {
  fov: 72,
  sprintFovKick: 7,
  /** Keyboard look: max turn rates (rad/s) and acceleration (rad/s²). */
  keyYawRate: 2.6,
  keyPitchRate: 1.7,
  keyAccel: 9,
  keyDecel: 18,
  mouseSensitivity: 0.0022,
  touchSensitivity: 0.0055,
  headBob: true,
  headBobAmount: 0.045,
  thirdPersonDistance: 4.2,
  thirdPersonShoulder: 0.55,
  thirdPersonHeight: 0.35,
};
