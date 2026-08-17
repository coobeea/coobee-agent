/** 本轮隐私/防火墙 enforce 默认值（编排层合成后注入）。 */
export interface PolicyDefaults {
  privacy: boolean;
  firewall: boolean;
}

export function defaultPolicyDefaults(): PolicyDefaults {
  return { privacy: false, firewall: false };
}
