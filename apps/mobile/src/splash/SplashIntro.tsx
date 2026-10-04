import { colors } from '@sellwasl/config';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

/**
 * Position des deux morceaux dans Logo.png (pixels de l'image d'origine) :
 * l'animation les replace exactement comme sur le logo.
 */
const SYMBOL = { x: 203, y: 335, width: 360, height: 269 };
const WORDMARK = { x: 604, y: 374, width: 732, height: 234 };
const LOGO = {
  x: SYMBOL.x,
  y: SYMBOL.y,
  width: WORDMARK.x + WORDMARK.width - SYMBOL.x,
  height: WORDMARK.y + WORDMARK.height - SYMBOL.y,
};

/** Même largeur que l'écran de démarrage natif (app.json, imageWidth) : aucun saut au relais. */
const NATIVE_SPLASH_WIDTH = 120;
const MAX_LOGO_WIDTH = 300;
const SIDE_MARGIN = 32;

/** Déroulé de l'animation, en millisecondes (environ 1,6 s au total). */
const TIMING = { pop: 450, move: 600, wordDelay: 200, word: 450, hold: 400, fadeOut: 250 };
/** Léger grossissement du symbole au relais de l'écran natif. */
const POP_SCALE = 1.08;
/** Distance parcourue par le nom en apparaissant. */
const WORD_SLIDE = 16;

/** Décalage du centre d'un morceau par rapport au centre du logo complet, à l'échelle k. */
function offsetFromLogoCenter(part: typeof SYMBOL, k: number) {
  return {
    x: (part.x + part.width / 2 - (LOGO.x + LOGO.width / 2)) * k,
    y: (part.y + part.height / 2 - (LOGO.y + LOGO.height / 2)) * k,
  };
}

/**
 * Animation du logo à l'ouverture, posée par-dessus la navigation :
 * le symbole prend le relais de l'écran natif, glisse à gauche, le nom apparaît.
 * Elle disparaît quand elle est finie ET que l'état du téléphone est connu (`ready`).
 */
export function SplashIntro({ ready }: { ready: boolean }) {
  const { width: screenWidth } = useWindowDimensions();
  const pop = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;
  const [played, setPlayed] = useState(false);
  const reduceMotionRef = useRef(false);
  const [gone, setGone] = useState(false);

  const k = Math.min(MAX_LOGO_WIDTH, screenWidth - SIDE_MARGIN * 2) / LOGO.width;
  const symbolOffset = offsetFromLogoCenter(SYMBOL, k);
  const wordOffset = offsetFromLogoCenter(WORDMARK, k);
  const symbolEndScale = (SYMBOL.width * k) / NATIVE_SPLASH_WIDTH;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        reduceMotionRef.current = reduceMotion;
        if (reduceMotion) {
          pop.setValue(1);
          move.setValue(1);
          word.setValue(1);
          setPlayed(true);
          return;
        }
        Animated.sequence([
          Animated.timing(pop, { toValue: 1, duration: TIMING.pop, useNativeDriver: true }),
          Animated.parallel([
            Animated.timing(move, {
              toValue: 1,
              duration: TIMING.move,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.delay(TIMING.wordDelay),
              Animated.timing(word, { toValue: 1, duration: TIMING.word, useNativeDriver: true }),
            ]),
          ]),
          Animated.delay(TIMING.hold),
        ]).start(() => setPlayed(true));
      });
    return () => {
      cancelled = true;
    };
  }, [pop, move, word]);

  useEffect(() => {
    if (!played || !ready) return;
    Animated.timing(overlay, {
      toValue: 0,
      duration: reduceMotionRef.current ? 0 : TIMING.fadeOut,
      useNativeDriver: true,
    }).start(() => setGone(true));
  }, [played, ready, overlay]);

  if (gone) return null;

  const symbolScale = Animated.multiply(
    pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, POP_SCALE, 1] }),
    move.interpolate({ inputRange: [0, 1], outputRange: [1, symbolEndScale] }),
  );

  return (
    <Animated.View
      pointerEvents={played && ready ? 'none' : 'auto'}
      style={[styles.overlay, { opacity: overlay }]}
      onLayout={() => SplashScreen.hide()}
    >
      <StatusBar style="dark" />
      <Animated.Image
        source={require('../../assets/brand/symbol.png')}
        style={[
          styles.piece,
          {
            width: NATIVE_SPLASH_WIDTH,
            height: (NATIVE_SPLASH_WIDTH * SYMBOL.height) / SYMBOL.width,
            transform: [
              {
                translateX: move.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, symbolOffset.x],
                }),
              },
              {
                translateY: move.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, symbolOffset.y],
                }),
              },
              { scale: symbolScale },
            ],
          },
        ]}
      />
      <Animated.Image
        source={require('../../assets/brand/wordmark.png')}
        accessibilityLabel="SellWasl — One Platform. Every Flow."
        style={[
          styles.piece,
          {
            width: WORDMARK.width * k,
            height: WORDMARK.height * k,
            opacity: word,
            transform: [
              {
                translateX: word.interpolate({
                  inputRange: [0, 1],
                  outputRange: [wordOffset.x - WORD_SLIDE, wordOffset.x],
                }),
              },
              { translateY: wordOffset.y },
            ],
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  piece: { position: 'absolute' },
});
