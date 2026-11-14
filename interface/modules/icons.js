const PATHS = {
  home: ['M2 11 12 3l10 8', 'M5 9v12h5v-7h4v7h5V9'],
  files: ['M3 6h7l2 3h9v11H3z', 'M3 9h9'],
  folderAdd: ['M3 6h7l2 3h9v11H3z', 'M12 12v6M9 15h6'],
  folderOpen: ['M3 20V6h7l2 3h8v3', 'M3 20l4-8h15l-4 8z'],
  notes: ['M5 3h10l4 4v14H5z', 'M15 3v5h4M8 11h8M8 14h8M8 17h5'],
  bookmarks: ['M6 3h12v18l-6-4-6 4z'],
  downloads: ['M12 3v12M7 10l5 5 5-5', 'M4 16v5h16v-5'],
  import: ['M14 3h6v18H4V3h4', 'M12 2v12M8 10l4 4 4-4M8 18h8'],
  export: ['M7 3H3v18h18v-8', 'M12 3h9v9M21 3 10 14'],
  passwords: ['M14 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M10 12 3 19v2h4v-3h3v-3', 'M15 7h1'],
  lock: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0v4M12 14v3'],
  lockOpen: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0M12 14v3'],
  settings: ['M9 2h6l1 3 3 1 3 4-2 2 2 2-3 4-3 1-1 3H9l-1-3-3-1-3-4 2-2-2-2 3-4 3-1z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M15 15l6 6'],
  plus: ['M12 4v16M4 12h16'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M9 10v7M15 10v7'],
  pencil: ['M3 21l1-6L16 3l5 5L9 20z', 'M13 6l5 5M4 15l5 5'],
  rename: ['M13 3h8M17 3v18M13 21h8', 'M14 7H3v10h11M20 7h2v10h-2'],
  copy: ['M8 8h13v13H8z', 'M5 16H3V3h13v2'],
  paste: ['M9 4H5v17h15V4h-4', 'M9 2h7v5H9zM8 11h9M8 15h9'],
  move: ['M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M8 8l12 12M8 16 20 4'],
  open: ['M14 3h7v7M21 3 10 14', 'M11 5H3v16h16v-8'],
  refresh: ['M20 10a8 8 0 0 0-14-4L3 9M3 3v6h6', 'M4 14a8 8 0 0 0 14 4l3-3M15 15h6v6'],
  save: ['M3 3h15l3 3v15H3z', 'M7 3v6h10V3M7 21v-8h10v8M14 4v3'],
  up: ['M12 21V4M5 11l7-7 7 7'],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  eye: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  eyeOff: ['M3 3l18 18M10 6h2c6 0 10 6 10 6s-1 2-3 3M14 18h-2C6 18 2 12 2 12s1-2 3-3'],
  check: ['M4 12l5 5L20 6'],
  close: ['M5 5l14 14M19 5 5 19'],
  drive: ['M7 3h10v7H7zM8 6h2M14 6h2', 'M6 10h12v11H6z'],
  file: ['M5 3h9l5 5v13H5z', 'M14 3v5h5'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l4 2'],
  warning: ['M12 3l10 18H2z', 'M12 9v6M12 17v1'],
  star: ['M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z'],
  power: ['M12 2v10', 'M6 5a9 9 0 1 0 12 0'],
  vpn: ['M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z', 'M8 10h8v6H8zM10 10V8a2 2 0 0 1 4 0v2'],
  shield: ['M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18'],
  server: ['M3 3h18v7H3zM3 14h18v7H3z', 'M6 6h2M11 6h7M6 17h2M11 17h7'],
};

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');
  svg.dataset.icon = name;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? PATHS.file) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}