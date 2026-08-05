export const BROWSER_SHELL_METRICS = {
  height: 50,
  trafficLightDiameter: 10,
  trafficLightStartX: 20,
  trafficLightGap: 16,
  addressX: 76,
  addressRight: 16,
  addressY: 8,
  addressHeight: 34,
  addressRadius: 17,
  addressIconX: 93,
  addressTextX: 108,
} as const;

export const BROWSER_SHELL_COLORS = {
  toolbar: '#ffffff',
  separator: 'rgba(24,24,27,.09)',
  address: '#f1f3f4',
  addressText: '#202124',
  addressIcon: '#5f6368',
} as const;

export function browserAddressLabel(value?: string) {
  const input = value?.trim() || 'example.com';
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return input;
  try {
    const url = new URL(input);
    return `${url.host.replace(/^www\./i, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
  } catch {
    return input.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  }
}
