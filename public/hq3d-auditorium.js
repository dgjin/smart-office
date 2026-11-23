const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function planAuditoriumLayout(width, depth){
  const stageDepth = Math.min(clamp(depth * 0.16, 1.4, 3.2), depth * 0.32);
  const stage = {
    x: 0,
    z: -depth / 2 + stageDepth / 2,
    width: Math.max(0, Math.min(width * 0.78, width - 0.6)),
    depth: stageDepth,
    height: 0.18
  };
  const frontGap = clamp(depth * 0.055, 0.65, 1.4);
  const seatingFront = -depth / 2 + stageDepth + frontGap;
  const seatingBack = depth / 2 - 0.52;
  const availableDepth = Math.max(0, seatingBack - seatingFront);
  const sideMargin = clamp(width * 0.035, 0.38, 0.72);
  const aisleWidth = width >= 3.4 ? clamp(width * 0.075, 0.8, 1.25) : 0;
  const bankWidth = Math.max(0, (width - sideMargin * 2 - aisleWidth) / 2);
  const columnPitch = 0.86;
  const rowPitch = 1.05;
  const seatWidth = 0.48;
  const seatDepth = 0.46;
  let columnsPerBank = Math.max(0, Math.floor((bankWidth - seatWidth) / columnPitch) + 1);
  let rows = Math.max(0, Math.floor((availableDepth - seatDepth) / rowPitch) + 1);
  const maxSeats = 320;
  if (columnsPerBank > 0 && rows * columnsPerBank * 2 > maxSeats){
    rows = Math.floor(maxSeats / (columnsPerBank * 2));
  }
  const seats = [];
  if (rows > 0 && columnsPerBank > 0){
    const rowBlockDepth = (rows - 1) * rowPitch + seatDepth;
    const firstZ = seatingFront + (availableDepth - rowBlockDepth) / 2 + seatDepth / 2;
    for (let row = 0; row < rows; row++){
      for (const side of [-1, 1]){
        const bankCenter = side * (aisleWidth / 2 + bankWidth / 2);
        for (let column = 0; column < columnsPerBank; column++){
          seats.push({
            x: bankCenter + (column - (columnsPerBank - 1) / 2) * columnPitch,
            z: firstZ + row * rowPitch,
            row: row + 1,
            column: column + 1,
            bank: side < 0 ? 'left' : 'right'
          });
        }
      }
    }
  }
  return {
    stage,
    seats,
    rows,
    columns: columnsPerBank * 2,
    aisle: {
      x: 0,
      z: (seatingFront + seatingBack) / 2,
      width: aisleWidth,
      depth: availableDepth
    },
    seatingFront,
    seatingBack
  };
}
