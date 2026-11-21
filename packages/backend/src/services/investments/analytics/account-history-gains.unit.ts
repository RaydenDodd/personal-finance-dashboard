import { accountGainSeries, sumGainSeries } from "./account-history-gains";

describe("cached dollar account gains", () => {
  it("removes deposits and withdrawals from period value changes, including the first day", () => {
    const result = accountGainSeries(
      [
        { date: "2026-10-31", value: "1000", funding: "800" },
        { date: "2026-11-01", value: "1250", funding: "1100" },
        { date: "2026-11-02", value: "1170", funding: "1000" },
      ],
      "2026-11-01",
    );
    expect(result.gains).toEqual(["200", "150", "170"]);
    expect(result.periodGains).toEqual([null, "-50", "-30"]);
  });
  it("does not invent missing funding or an opening observation", () => {
    expect(
      accountGainSeries(
        [{ date: "2026-11-01", value: "500", funding: null }],
        "2026-11-01",
      ),
    ).toEqual({ gains: [null], periodGains: [null] });
    expect(
      accountGainSeries(
        [{ date: "2026-11-01", value: "500", funding: "400" }],
        "2026-11-01",
      ).periodGains,
    ).toEqual([null]);
    expect(
      sumGainSeries(
        [
          ["10", null],
          [null, null],
        ],
        2,
      ),
    ).toEqual(["10", null]);
  });
});
