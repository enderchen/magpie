/* global gsap */
'use strict';

(() => {
  const stage = document.querySelector('.footer-landscape');
  const courier = document.querySelector('.footer-courier');
  const facing = document.getElementById('footer-bird-facing');
  const body = document.getElementById('footer-bird-bob');
  const nearWing = document.getElementById('footer-near-wing');
  const farWing = document.getElementById('footer-far-wing');
  if (!stage || !courier || !facing || !body || !nearWing || !farWing || typeof gsap === 'undefined') return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let flight;
  let wingbeat;
  let lift;
  let resizeFrame;

  function buildFlight() {
    flight?.kill();
    wingbeat?.kill();
    lift?.kill();
    gsap.set([courier, facing, body, nearWing, farWing], { clearProps: 'transform' });
    gsap.set(nearWing, { rotation: 52, transformOrigin: '108px 78px' });
    gsap.set(farWing, { rotation: 46, transformOrigin: '116px 78px' });

    if (reducedMotion.matches) {
      gsap.set(courier, { x: (stage.clientWidth - courier.getBoundingClientRect().width) / 2 });
      return;
    }

    const start = -courier.getBoundingClientRect().width - 12;
    const finish = stage.clientWidth + 12;
    const duration = Math.max(6, stage.clientWidth / 190);
    gsap.set(courier, { x: start });
    gsap.set(facing, { scaleX: 1, transformOrigin: '50% 50%' });

    // Wings rotate about the shoulders. The quicker downstroke gives lift;
    // the slower recovery returns them above the body without changing span.
    wingbeat = gsap.timeline({ repeat: -1 })
      .to(nearWing, { rotation: -48, duration: .36, ease: 'power2.in' }, 0)
      .to(farWing, { rotation: -43, duration: .36, ease: 'power2.in' }, 0)
      .to(nearWing, { rotation: 52, duration: .56, ease: 'sine.inOut' }, .36)
      .to(farWing, { rotation: 46, duration: .56, ease: 'sine.inOut' }, .36);
    lift = gsap.timeline({ repeat: -1 })
      .to(body, { y: -7, duration: .36, ease: 'power1.out' })
      .to(body, { y: 2, duration: .56, ease: 'sine.inOut' });
    flight = gsap.timeline({ repeat: -1 })
      .to(courier, { x: finish, duration, ease: 'none' })
      .set(facing, { scaleX: -1 })
      .to(courier, { x: start, duration, ease: 'none' })
      .set(facing, { scaleX: 1 });
  }

  buildFlight();
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(buildFlight);
  });
  reducedMotion.addEventListener('change', buildFlight);
})();
