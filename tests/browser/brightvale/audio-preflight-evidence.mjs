function parseRatio(value, label) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value));
  if (!match || Number(match[2]) === 0) {
    throw new Error(`${label} must be a positive rational`);
  }
  return [BigInt(match[1]), BigInt(match[2])];
}

function sideDataValue(packet, key) {
  const sideData = packet.side_data_list ?? [];
  const item = sideData.find((entry) => entry.side_data_type === 'Skip Samples');
  return BigInt(item?.[key] ?? 0);
}

/** Reconstruct decoder output sample count from MP3 frame and trim metadata. */
export function expectedDecodedMp3Samples({ packets, timeBase, sampleRate }) {
  if (!Array.isArray(packets) || packets.length === 0) {
    throw new Error('MP3 packet evidence must contain at least one packet');
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('MP3 sample rate must be a positive integer');
  }
  const [timeNumerator, timeDenominator] = parseRatio(timeBase, 'time base');
  const durationTicks = packets.reduce((total, packet) => {
    if (!/^\d+$/.test(String(packet.duration ?? ''))) {
      throw new Error('MP3 packet is missing integer duration ticks');
    }
    return total + BigInt(packet.duration);
  }, 0n);
  const decodedSamplesNumerator =
    durationTicks * timeNumerator * BigInt(sampleRate);
  if (decodedSamplesNumerator % timeDenominator !== 0n) {
    throw new Error('MP3 packet timeline does not resolve to whole samples');
  }
  const packetSamples = decodedSamplesNumerator / timeDenominator;
  const skippedSamples = sideDataValue(packets[0], 'skip_samples');
  const discardedSamples = sideDataValue(
    packets.at(-1),
    'discard_padding',
  );
  const decodedSamples = packetSamples - skippedSamples - discardedSamples;
  if (decodedSamples <= 0n || decodedSamples > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('MP3 trim metadata produces an invalid decoded sample count');
  }
  return {
    packetSamples: Number(packetSamples),
    skippedSamples: Number(skippedSamples),
    discardedSamples: Number(discardedSamples),
    decodedSamples: Number(decodedSamples),
  };
}

/** Classify timing evidence without inventing a duration tolerance. */
export function classifyDurationEvidence({
  chartDuration,
  decodedDuration,
  decodedLength,
  decodedSampleRate,
  containerDuration,
  expectedDecodedSamples,
}) {
  const residual = decodedDuration - chartDuration;
  if (decodedDuration < chartDuration) {
    return {
      residual,
      classification: 'shortfall-blocks-integration',
      blocksIntegration: true,
    };
  }
  if (residual === 0) {
    return {
      residual,
      classification: 'exact-duration-match',
      blocksIntegration: false,
    };
  }
  const decodedLengthMatchesMp3Timeline =
    decodedLength === expectedDecodedSamples &&
    decodedDuration === decodedLength / decodedSampleRate;
  if (
    decodedLengthMatchesMp3Timeline &&
    Number(containerDuration) === chartDuration
  ) {
    return {
      residual,
      classification: 'mp3-trim-metadata-and-container-rounding-supported',
      blocksIntegration: false,
    };
  }
  return {
    residual,
    classification: 'unexplained-positive-residual-blocks-integration',
    blocksIntegration: true,
  };
}
