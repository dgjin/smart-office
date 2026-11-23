import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planAuditoriumLayout } from '../public/hq3d-auditorium.js';

describe('总部3D礼堂比例排座', () => {
  it('座位随可用面积增加且不突破实例化预算', () => {
    const compact = planAuditoriumLayout(12, 18);
    const wider = planAuditoriumLayout(18, 18);
    const deeper = planAuditoriumLayout(12, 28);
    assert.ok(compact.seats.length > 0);
    assert.ok(wider.seats.length > compact.seats.length);
    assert.ok(deeper.seats.length > compact.seats.length);
    assert.equal(wider.columns > compact.columns, true);
    assert.equal(deeper.rows > compact.rows, true);
    assert.ok(planAuditoriumLayout(60, 80).seats.length <= 320);
  });

  it('主席台尺寸随房间比例变化并保留台前通道', () => {
    const layout = planAuditoriumLayout(16, 26);
    assert.ok(Math.abs(layout.stage.width - 16 * 0.78) < 1e-9);
    assert.ok(layout.stage.depth > 0);
    assert.ok(layout.seats.every(seat => seat.z - 0.23 >= layout.seatingFront - 1e-9));
    assert.ok(layout.seatingFront > layout.stage.z + layout.stage.depth / 2);
  });

  it('所有座位位于房间边界内且中央过道无座椅', () => {
    const width = 16;
    const depth = 26;
    const layout = planAuditoriumLayout(width, depth);
    assert.ok(layout.aisle.width >= 0.8);
    for (const seat of layout.seats){
      assert.ok(Math.abs(seat.x) + 0.24 <= width / 2 + 1e-9);
      assert.ok(Math.abs(seat.z) + 0.23 <= depth / 2 + 1e-9);
      assert.ok(Math.abs(seat.x) - 0.24 >= layout.aisle.width / 2 - 1e-9);
    }
  });

  it('相同面积的宽厅与深厅使用不同行列组合', () => {
    const wide = planAuditoriumLayout(24, 14);
    const deep = planAuditoriumLayout(14, 24);
    assert.ok(wide.seats.length > 0);
    assert.ok(deep.seats.length > 0);
    assert.ok(wide.columns > deep.columns);
    assert.ok(deep.rows > wide.rows);
  });
});
