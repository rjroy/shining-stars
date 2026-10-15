import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDurationEvidence,
  expectedDecodedMp3Samples,
} from './audio-preflight-evidence.mjs';

test('MP3 frame timeline subtracts encoder delay and tail padding', () => {
  const result = expectedDecodedMp3Samples({
    packets: [
      {
        duration: '338688',
        side_data_list: [
          { side_data_type: 'Skip Samples', skip_samples: 1105 },
        ],
      },
      {
        duration: '338688',
        side_data_list: [
          { side_data_type: 'Skip Samples', discard_padding: 816 },
        ],
      },
    ],
    timeBase: '1/14112000',
    sampleRate: 48000,
  });

  assert.deepEqual(result, {
    packetSamples: 2304,
    skippedSamples: 1105,
    discardedSamples: 816,
    decodedSamples: 383,
  });
});

test('shortfalls and unexplained residuals block without a tolerance', () => {
  const shortfall = classifyDurationEvidence({
    chartDuration: 10,
    decodedDuration: 9.99,
    decodedLength: 479520,
    decodedSampleRate: 48000,
    containerDuration: '10.000000',
    expectedDecodedSamples: 480000,
  });
  assert.equal(shortfall.classification, 'shortfall-blocks-integration');
  assert.equal(shortfall.blocksIntegration, true);

  const unexplained = classifyDurationEvidence({
    chartDuration: 10,
    decodedDuration: 10.1,
    decodedLength: 484800,
    decodedSampleRate: 48000,
    containerDuration: '10.000000',
    expectedDecodedSamples: 480000,
  });
  assert.equal(
    unexplained.classification,
    'unexplained-positive-residual-blocks-integration',
  );
  assert.equal(unexplained.blocksIntegration, true);
});

test('sample-exact decoded output plus MP3 trim metadata explains positive rounding residual', () => {
  const evidence = classifyDurationEvidence({
    chartDuration: 1.999,
    decodedDuration: 2,
    decodedLength: 96000,
    decodedSampleRate: 48000,
    containerDuration: '1.999000',
    expectedDecodedSamples: 96000,
  });
  assert.deepEqual(evidence, {
    residual: 0.0009999999999998899,
    classification: 'mp3-trim-metadata-and-container-rounding-supported',
    blocksIntegration: false,
  });
});

test('equal decoded and authored intervals are classified as exact', () => {
  const evidence = classifyDurationEvidence({
    chartDuration: 10,
    decodedDuration: 10,
    decodedLength: 480000,
    decodedSampleRate: 48000,
    containerDuration: '10.000000',
    expectedDecodedSamples: 480000,
  });
  assert.equal(evidence.classification, 'exact-duration-match');
  assert.equal(evidence.blocksIntegration, false);
});
