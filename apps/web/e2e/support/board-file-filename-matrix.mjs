// Original transport/display names stay exact. Only browser disk names normalize.
export const boardFileFilenameCases = [
  {fileName: 'plain.txt', encodedName: 'plain.txt', chromiumSavedName: 'plain.txt'},
  {fileName: "O'Brien.txt", encodedName: 'O%27Brien.txt', chromiumSavedName: "O'Brien.txt"},
  {fileName: 'brackets[1].txt', encodedName: 'brackets%5B1%5D.txt', chromiumSavedName: 'brackets[1].txt'},
  {fileName: 'star*.txt', encodedName: 'star%2A.txt', chromiumSavedName: 'star_.txt'},
  {fileName: '中文.txt', encodedName: '%E4%B8%AD%E6%96%87.txt', chromiumSavedName: '中文.txt'},
  {fileName: '100%.txt', encodedName: '100%25.txt', chromiumSavedName: '100%.txt'},
  {fileName: '"quoted".txt', encodedName: '%22quoted%22.txt', chromiumSavedName: '_quoted_.txt'},
];
