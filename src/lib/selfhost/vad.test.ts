import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Vad } from "./vad.ts";

function run(vad: Vad, levels: number[], dt = 20): string[] {
  return levels.map((l) => vad.process(l, dt)).filter((e): e is "start" | "end" => e !== null);
}

describe("Vad", () => {
  it("detects speech after a short run of loud blocks and ends after silence", () => {
    const vad = new Vad();
    const quiet = Array(30).fill(0.003);
    const loud = Array(30).fill(0.1);
    const events = run(vad, [...quiet, ...loud, ...Array(50).fill(0.003)]);
    assert.deepEqual(events, ["start", "end"]);
  });

  it("ignores a brief click", () => {
    const vad = new Vad();
    assert.deepEqual(run(vad, [...Array(20).fill(0.003), 0.2, 0.2, ...Array(40).fill(0.003)]), []);
  });

  it("adapts to a noisy room and keeps going through short pauses", () => {
    const vad = new Vad();
    const events = run(vad, [...Array(60).fill(0.01), ...Array(20).fill(0.2), ...Array(10).fill(0.01), ...Array(20).fill(0.2), ...Array(60).fill(0.01)]);
    assert.deepEqual(events, ["start", "end"], "a 200 ms pause does not split the sentence");
  });

  it("can be reset mid-speech", () => {
    const vad = new Vad();
    run(vad, Array(20).fill(0.2));
    assert.equal(vad.isSpeaking, true);
    vad.reset();
    assert.equal(vad.isSpeaking, false);
  });
});
