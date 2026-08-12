// Tiny in-memory stand-in for @saltcorn/data/models/metadata. PhaseHelper and
// ChainHelper only ever query it with simple {type, name}/{id} where-clauses,
// so this is enough to unit test them without a real DB.
let rows = [];
let nextId = 1;

const matches = (row, where) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

class FakeMetaData {
  constructor(row) {
    Object.assign(this, row);
  }
  static async find(where = {}) {
    return rows
      .filter((r) => matches(r, where))
      .map((r) => new FakeMetaData(r));
  }
  static async findOne(where = {}) {
    const r = rows.find((r) => matches(r, where));
    return r ? new FakeMetaData(r) : undefined;
  }
  static async create(cfg) {
    const row = { id: nextId++, written_at: new Date(), ...cfg };
    rows.push(row);
    return new FakeMetaData(row);
  }
  async update(cfg) {
    const idx = rows.findIndex((r) => r.id === this.id);
    rows[idx] = { ...rows[idx], ...cfg };
    Object.assign(this, cfg);
  }
  async delete() {
    rows = rows.filter((r) => r.id !== this.id);
  }
}

FakeMetaData.reset = () => {
  rows = [];
  nextId = 1;
};

module.exports = { FakeMetaData };
