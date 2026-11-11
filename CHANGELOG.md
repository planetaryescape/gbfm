## [2.131.2](https://github.com/planetaryescape/gbfm/compare/v2.131.1...v2.131.2) (2026-11-11)


### Bug Fixes

* **mcp:** fetch import artwork with Worker-compatible redirect handling ([8f46821](https://github.com/planetaryescape/gbfm/commit/8f4682108c6881ad7a102e5456ba9630444653c1))

## [2.131.1](https://github.com/planetaryescape/gbfm/compare/v2.131.0...v2.131.1) (2026-11-11)


### Bug Fixes

* **mcp:** diagnose recoverable artwork import failures ([80994b8](https://github.com/planetaryescape/gbfm/commit/80994b8df5baa767637aeadb17ca82e48293bb68))

# [2.131.0](https://github.com/planetaryescape/gbfm/compare/v2.130.1...v2.131.0) (2026-11-11)


### Features

* **mcp:** enable durable music imports with recoverable artwork ([7beac63](https://github.com/planetaryescape/gbfm/commit/7beac63532c014f76b4add47e0a978257b47897c))

## [2.130.1](https://github.com/planetaryescape/gbfm/compare/v2.130.0...v2.130.1) (2026-11-10)


### Bug Fixes

* **www:** render OAuth client logos without brand-specific matching ([2fca37d](https://github.com/planetaryescape/gbfm/commit/2fca37d562026efa9314b81fcba3086e32bf3341))
* **www:** show the supplied OpenCode brand on consent screens ([bd14d50](https://github.com/planetaryescape/gbfm/commit/bd14d504b2f7945736b060a12923bc7a89ade658))

# [2.130.0](https://github.com/planetaryescape/gbfm/compare/v2.129.0...v2.130.0) (2026-11-10)


### Bug Fixes

* **mcp:** reject disabled permissions before consent ([defbfa0](https://github.com/planetaryescape/gbfm/commit/defbfa0e08376a7480052f2c3cd530c19b630200))


### Features

* **mcp:** add explicit versioned resource-policy rollouts ([09f24d1](https://github.com/planetaryescape/gbfm/commit/09f24d1f797e1e7b05d452a95c7a121633285410))
* **mobile:** align tweet resume and discovery with web ([1942192](https://github.com/planetaryescape/gbfm/commit/19421921099505281fc5820ea3764e06bf4e0440))

# [2.129.0](https://github.com/planetaryescape/gbfm/compare/v2.128.0...v2.129.0) (2026-11-09)


### Bug Fixes

* **creator:** roll back lost authority and budget actual acknowledgements ([3593f8d](https://github.com/planetaryescape/gbfm/commit/3593f8d9f0680193d117c866afb97cdaa7bae098))
* **deploy:** expose bounded legacy migration preflight diagnostics ([efb6d61](https://github.com/planetaryescape/gbfm/commit/efb6d619faabd57dd0edf5debdf9a65126884819))
* **deploy:** gate MCP migrations on read-only production preflight ([0643f88](https://github.com/planetaryescape/gbfm/commit/0643f884d20759dadc58318dddb54dc46a783e16))
* **deploy:** preserve verified production migration ledger ([f9c2853](https://github.com/planetaryescape/gbfm/commit/f9c2853ec8c7797836e25cc0450f8c1dacb9bb4a))
* **editorial:** bound full reference guards and wire results before commit ([ba7e437](https://github.com/planetaryescape/gbfm/commit/ba7e43702cc6c6f4816880531295172aec841b53))
* **editorial:** fence live authority and preserve canonical reference identity ([b1b3345](https://github.com/planetaryescape/gbfm/commit/b1b3345d92bb1455f1e942c21e9b361d7a394073))
* **favorites:** preserve sessions on target access denial ([7025e7b](https://github.com/planetaryescape/gbfm/commit/7025e7b65f32272e350a3e20a593a5ce97a30309))
* **listening:** bind writes and replay to live credential authority ([850a0b2](https://github.com/planetaryescape/gbfm/commit/850a0b231810ba85fc7b8f3327d980505af76db4))
* **mcp:** bound link snapshot SQL parameters ([e1314e6](https://github.com/planetaryescape/gbfm/commit/e1314e62f565bb0bee343a6b31c4192bfdb5a2e3))
* **mcp:** bound music revisions and preserve SQLite ordering ([6947207](https://github.com/planetaryescape/gbfm/commit/6947207dbc8665aad6c5a784f2b1dbfb23aa4724))
* **mcp:** close music import preparation review gaps ([c59ef8b](https://github.com/planetaryescape/gbfm/commit/c59ef8bbcef1911f2e43296174f026028426c339))
* **mcp:** compose request-visible commands and prove granted writes ([6cc3126](https://github.com/planetaryescape/gbfm/commit/6cc3126a7eac44604e350866a51a95fc0db40062))
* **mcp:** constrain music read queries and wire response budget ([2407cea](https://github.com/planetaryescape/gbfm/commit/2407ceac7a2e6de88a90a4785757a0753bf49987))
* **mcp:** group music authority and attempt predicates ([a23e607](https://github.com/planetaryescape/gbfm/commit/a23e6077a1da7f114c82200614dad51742b95021))
* **mcp:** group opaque music fact guards ([7bf087d](https://github.com/planetaryescape/gbfm/commit/7bf087d134e13b7ecdd935af441cb1d5d28f6678))
* **mcp:** keep generic import type authority pending ([a638ae3](https://github.com/planetaryescape/gbfm/commit/a638ae3682378861389767146edd8493c21ebe43))
* **mcp:** keep search output discoverable by SDK clients ([8ab003b](https://github.com/planetaryescape/gbfm/commit/8ab003b2f6dc36ec5c7f671711acb69ca5b3ce98))
* **mcp:** make public thread snapshots and source projection safe ([646d959](https://github.com/planetaryescape/gbfm/commit/646d959e74293f72999e439dc0648245731a6613))
* **mcp:** page kind-only catalogue reads in primary key order ([82166c5](https://github.com/planetaryescape/gbfm/commit/82166c500a7e84591ee3bae5555ff82751057e44))
* **mcp:** preserve draft inserts after reference schema extension ([695bb12](https://github.com/planetaryescape/gbfm/commit/695bb12d2149bcbe123f0b6e7661909c4c3ea5ee))
* **mcp:** recheck editorial source access before disclosure ([3403403](https://github.com/planetaryescape/gbfm/commit/3403403453f7dc6acb30997d97d13e214b115483))
* **mcp:** reject NUL bypasses in proposal scalar bounds ([5bf9821](https://github.com/planetaryescape/gbfm/commit/5bf9821a52063f47d9c4ed80144fa4e37946491a))
* **mcp:** reject site-local IPv6 evidence sources ([6163cda](https://github.com/planetaryescape/gbfm/commit/6163cda546abff9743c93256193b7b6f6c68a19e))
* **mcp:** report scrubbed operation storage failures ([c4ca3e8](https://github.com/planetaryescape/gbfm/commit/c4ca3e828a812143605044e59399238dfbc3c30c))
* **mcp:** retain canonical writer display aliases in reads ([fe817a5](https://github.com/planetaryescape/gbfm/commit/fe817a54d02f40d2f6ddb4f8c6e218751aa5f732))
* **mcp:** retain verified snapshot import display links ([c7e1c30](https://github.com/planetaryescape/gbfm/commit/c7e1c30440fd92750da5921edf23ec250b36f9dc))
* **mcp:** separate static fact validation from freshness checks ([1f04c7e](https://github.com/planetaryescape/gbfm/commit/1f04c7e648cdf98febd79c6718b240a7cc11e344))
* **music:** classify protected deletes as conflicts ([48c5662](https://github.com/planetaryescape/gbfm/commit/48c56624266c757f891dd1e34b4fd1c783749cde))
* **music:** restrict artist credit removal to its album ([9269512](https://github.com/planetaryescape/gbfm/commit/92695123f88becb0bd6dd4887f4b1a44a2f01414))
* **playlists:** establish shared public visibility and safe embed reads ([37b4d08](https://github.com/planetaryescape/gbfm/commit/37b4d08208f0014adbb1e15d5ba5cb595f0348e6))
* **playlists:** keep interruptions out of progress outcomes ([f0654b2](https://github.com/planetaryescape/gbfm/commit/f0654b2d05d9d9ef70f238b4ed2ae158a873fedb))
* **posts:** isolate correlated ancestor ID scope ([f5c4805](https://github.com/planetaryescape/gbfm/commit/f5c480509af744d8ee36b1e234e0549bf236d017))
* **reminders:** report safe failures and expose observed revisions ([44f1ddf](https://github.com/planetaryescape/gbfm/commit/44f1ddfd4313091d329e33bd84e00ad7175f505c))
* **www:** carry observed membership revisions across controls ([51878d7](https://github.com/planetaryescape/gbfm/commit/51878d7efd71ce147fb1d10c42b6483c593cfbdf))
* **www:** preserve revision-bound dashboard removal intents ([25710b8](https://github.com/planetaryescape/gbfm/commit/25710b8de88195817d21f8087f778a727c856ed4))
* **www:** recover from refused dashboard removal intents ([dccd057](https://github.com/planetaryescape/gbfm/commit/dccd0579271607b9672497290f2cfcf0623fa148))


### Features

* **creator:** add atomic version-fenced command candidates ([8fcbf9b](https://github.com/planetaryescape/gbfm/commit/8fcbf9b5bea9d0d057a36397941a6853dd6a233f))
* **creator:** fence public replies with same-insert ancestry ([17b7409](https://github.com/planetaryescape/gbfm/commit/17b740959b0238c9d370a6613d052143ef4ee697))
* **editorial:** define ordered draft music reference transitions ([f881432](https://github.com/planetaryescape/gbfm/commit/f8814321f4f41c3f20f8936a08d5c27303955d30))
* **editorial:** share atomic draft music writes and coherent versions ([165bd66](https://github.com/planetaryescape/gbfm/commit/165bd66a148c30ab94548db48c4a67ffd59a73c8))
* **favorites:** guard membership commands with durable owner revisions ([5455014](https://github.com/planetaryescape/gbfm/commit/54550148921784e49a1ed64ee7205dd2343b21fb))
* **listening:** add private replay-safe commands and versioned writers ([c3a72af](https://github.com/planetaryescape/gbfm/commit/c3a72af4d0b2b3785f63c1245cd0cafcbe9d6ee3))
* **mcp:** add bounded admin catalogue diagnostics ([29cb51a](https://github.com/planetaryescape/gbfm/commit/29cb51a1f25d48aaeb1854013c92a47cd3410668))
* **mcp:** add bounded anonymous micro-thread projection ([73a0884](https://github.com/planetaryescape/gbfm/commit/73a0884033de890fa70ac33b5dbd92765d66e1db))
* **mcp:** add bounded public music catalogue reads ([69455d1](https://github.com/planetaryescape/gbfm/commit/69455d129298d63c9c454d0b6c5b3800f49261fa))
* **mcp:** add bounded public playlist reads and shared snapshots ([6d76116](https://github.com/planetaryescape/gbfm/commit/6d76116b5407026b53390f85e4bf6eed8a809032))
* **mcp:** add fenced music fact replacement statements ([439e977](https://github.com/planetaryescape/gbfm/commit/439e977195ed07d00e3bfc1f3d23998fb2470538))
* **mcp:** add guarded draft music reference replacement ([fd3b03e](https://github.com/planetaryescape/gbfm/commit/fd3b03e0485c7fdb61c45eefe4f0a8dd45d68b93))
* **mcp:** add read-only music edit preview and revision proof ([e54e43a](https://github.com/planetaryescape/gbfm/commit/e54e43a8d23344633b0f44366260be08fb7db3c5))
* **mcp:** add receipt-fenced manual music link commands ([4756191](https://github.com/planetaryescape/gbfm/commit/47561911d738ce2a915c1a50bc9a267d0eff2543))
* **mcp:** add sourced public research and catalogue recommendations ([4580a06](https://github.com/planetaryescape/gbfm/commit/4580a06a2a9d7af1aad614bc95435534d16a024a))
* **mcp:** assert physical winners before atomic deletion ([aa33966](https://github.com/planetaryescape/gbfm/commit/aa3396668b79a6401cf21f68711933cf10e70091))
* **mcp:** bind command checkpoints to live persisted credentials ([6410b09](https://github.com/planetaryescape/gbfm/commit/6410b0958f920edeff317c860e8b167b970b6aca))
* **mcp:** bound catalogue query admission and index ordered reads ([61da424](https://github.com/planetaryescape/gbfm/commit/61da4248088ee13b6078d1aff7e720bcd0ab4819))
* **mcp:** commit manual music creates with original receipts ([4f90f3e](https://github.com/planetaryescape/gbfm/commit/4f90f3eb7c2bf14df127a3d7eb4c759593df8f6a))
* **mcp:** complete editorial context and recommendation reads ([39af387](https://github.com/planetaryescape/gbfm/commit/39af387eaeb58f73f1f986994ad06cfc70be6040))
* **mcp:** compose operation store with request database ([a7c9b24](https://github.com/planetaryescape/gbfm/commit/a7c9b24c727c7fc0e7c10f66d03355a6c967d374))
* **mcp:** define creator revisions and review and merge facts ([153692a](https://github.com/planetaryescape/gbfm/commit/153692a56423e741b177481302103209c135a353))
* **mcp:** define guarded domain revisions and fact schemas ([9facf86](https://github.com/planetaryescape/gbfm/commit/9facf86a5eae80e977c5b13bf63e4335d216ae10))
* **mcp:** execute guarded music edits through shared receipts ([2f0d60a](https://github.com/planetaryescape/gbfm/commit/2f0d60a252c336f54b71c3465c4ca17b78dbe3f7))
* **mcp:** execute guarded music fact replacements ([2eb1620](https://github.com/planetaryescape/gbfm/commit/2eb1620f484444ba9ef8b2f4648bcd2d4374f4f0))
* **mcp:** expand music preview and share guarded music statements ([5ba5f6e](https://github.com/planetaryescape/gbfm/commit/5ba5f6ed6f237abd70dd9c009ca9fd3829c30deb))
* **mcp:** expose actual-request encoded response budget ([4154762](https://github.com/planetaryescape/gbfm/commit/415476294ffbedca03dcd604ad0a0443cbad771e))
* **mcp:** expose authorized receipt preflight lookup ([125df0b](https://github.com/planetaryescape/gbfm/commit/125df0bd411ff3f4a0b992d9b0dfffe91a025407))
* **mcp:** expose bounded read-only music link inspection ([fe43cc2](https://github.com/planetaryescape/gbfm/commit/fe43cc228b44f54b9b4037b63be5aacbdbc975ae))
* **mcp:** fence playlist commands with bounded revisions ([84b9b6b](https://github.com/planetaryescape/gbfm/commit/84b9b6b60d1d0da15495c96e70950d238f982c82))
* **mcp:** persist bounded playlist import status and outbox ([fe05b4a](https://github.com/planetaryescape/gbfm/commit/fe05b4a2cc1a29b6cfd138139b98b79ecde439ed))
* **mcp:** persist fenced artwork recovery phases ([f18691d](https://github.com/planetaryescape/gbfm/commit/f18691d27fe39df0bec65e09222091043535d98f))
* **mcp:** prepare domain plans after receipt lookup ([80fbc63](https://github.com/planetaryescape/gbfm/commit/80fbc63944e48c16c5c1f2c6e9f0d6100cc6bc99))
* **mcp:** prepare identity-preserving music fact replacements ([fd0b2d2](https://github.com/planetaryescape/gbfm/commit/fd0b2d2fd604e6ed6b6ea91fff0a8edf2be4514a))
* **mcp:** prepare music import commands behind durability gate ([a8872f9](https://github.com/planetaryescape/gbfm/commit/a8872f94029c237b84950052aebe7734d33eae09))
* **mcp:** recheck live import authority at execution boundaries ([d4f1f0d](https://github.com/planetaryescape/gbfm/commit/d4f1f0d1c9da7ad806fadf8dcf3de8cba358a68e))
* **mcp:** share durable fenced operation receipts ([a74fdf2](https://github.com/planetaryescape/gbfm/commit/a74fdf2bd5b925b38492f3117b1ee9d6720fd28e))
* **mcp:** validate recording credit and alias replacements ([142f9ae](https://github.com/planetaryescape/gbfm/commit/142f9ae11fdd3f8a1469a9486e3f2c08ebad09d4))
* **music:** define required canonical write intent ([06491d4](https://github.com/planetaryescape/gbfm/commit/06491d462d3d5a52b7fa5df4a7cea2437be37d9a))
* **music:** fence session deletions with observed revisions ([fa7d1fc](https://github.com/planetaryescape/gbfm/commit/fa7d1fc8f8ad392b02ddd9c1880a8ed04d7a21c0))
* **music:** guard artist metadata with shared observed write intent ([f5428e0](https://github.com/planetaryescape/gbfm/commit/f5428e0b74bb3c57970a29b05ae1f1f1d8b14ed6))
* **music:** guard metadata and relationship writes atomically ([af1b68b](https://github.com/planetaryescape/gbfm/commit/af1b68b5ed6a01c940c64ed4261b702a9da97ec3))
* **music:** prepare guarded canonical metadata writes ([78016ee](https://github.com/planetaryescape/gbfm/commit/78016ee5fab57efa001fea798c3ef7affa65098a))
* **playlists:** define guarded curation contracts and pure change plans ([0302e5c](https://github.com/planetaryescape/gbfm/commit/0302e5c8c8ec0617cdfbe47c2851d3ca2defd207))
* **playlists:** expose actual import and enrichment progress ([79c8c9d](https://github.com/planetaryescape/gbfm/commit/79c8c9d77d05d6ae97e5e870cad97ee71d702301))
* **playlists:** fence import status retirement with parent deletion ([0c6ce21](https://github.com/planetaryescape/gbfm/commit/0c6ce215ce97b3cd698485aa3745bbf06dabf316))
* **playlists:** fence local curation commands with shared receipts ([e4b8758](https://github.com/planetaryescape/gbfm/commit/e4b875826309417408089919adb55871f5e35e53))
* **playlists:** persist authorized import lifecycle and outbox state ([9aac099](https://github.com/planetaryescape/gbfm/commit/9aac0994402860c65bc859b90ece4e012f70f68c))
* **posts:** expose read-only creator command preparation ([0dfb6fe](https://github.com/planetaryescape/gbfm/commit/0dfb6fe0b4f4f280e792601d4aaf789cd0d5f989))
* **posts:** share bounded public ancestor SQL guards ([407c1d8](https://github.com/planetaryescape/gbfm/commit/407c1d8ce355788ed17b2cf14330cddd12659ee2))
* **reminders:** arbitrate durable commands with dispatch fencing ([fc22635](https://github.com/planetaryescape/gbfm/commit/fc22635181e7c668a812b2961cc73fecd1d0214c))
* **reminders:** require observed revisions on session writes ([48484b6](https://github.com/planetaryescape/gbfm/commit/48484b60b565edf570bc2e318b2b3169d2d02593))

# [2.128.0](https://github.com/planetaryescape/gbfm/compare/v2.127.0...v2.128.0) (2026-11-09)


### Bug Fixes

* **mcp:** address admin-read review findings ([2d47372](https://github.com/planetaryescape/gbfm/commit/2d4737272973de24d3df6dd4679006a279de158a))
* **mcp:** address listening review diagnostics and evidence ([fb21633](https://github.com/planetaryescape/gbfm/commit/fb21633de80247fe06bf77f541bd845240677e9a))
* **mcp:** address public content review feedback ([e4b9fc7](https://github.com/planetaryescape/gbfm/commit/e4b9fc7d057bae2785b16c85d1e79ec25d490e54))
* **mcp:** admit id-less calls through the permission guard ([2d1b559](https://github.com/planetaryescape/gbfm/commit/2d1b5592826e66e3a198dc117c153e062264fc5c))
* **mcp:** advertise only resource-enabled tool scopes ([1d4cf62](https://github.com/planetaryescape/gbfm/commit/1d4cf62ff0cbfa59eeab52c8d3b7da24bd28cce2))
* **mcp:** await resource policy initialization for discovery ([2fa6712](https://github.com/planetaryescape/gbfm/commit/2fa6712689521ab8d48085873c845b63ea4c2ffa))
* **mcp:** bound reminder envelopes and diagnose read failures ([c223f89](https://github.com/planetaryescape/gbfm/commit/c223f89f275ffea9e8193a040e4ae04de9a00368))
* **mcp:** distinguish user and artist profile identities ([113455e](https://github.com/planetaryescape/gbfm/commit/113455ecaf71788bbd405adcdbe193858ce18999))
* **mcp:** enforce live scope admission before consent and dispatch ([3686ad6](https://github.com/planetaryescape/gbfm/commit/3686ad6f2b429e1586ab786c54b9dd165dc18ee4))
* **mcp:** isolate oversized saved-item summaries ([aa522bc](https://github.com/planetaryescape/gbfm/commit/aa522bc430a8a1a4e2ab2f9d9489284272459505))
* **mcp:** strengthen composed research evidence and guide ([4952a03](https://github.com/planetaryescape/gbfm/commit/4952a03a4d73afab45feb72c6b893ffce7be7631))


### Features

* **mcp:** add bounded owner favorites and subscription reads ([7a40cb2](https://github.com/planetaryescape/gbfm/commit/7a40cb24b5388532ec14bb7b01f2c4361f4fd5e7))
* **mcp:** add bounded private listening reads ([d340af3](https://github.com/planetaryescape/gbfm/commit/d340af34ed52321024e59b42447f233655636cd6))
* **mcp:** add bounded public editorial and show reads ([07ba384](https://github.com/planetaryescape/gbfm/commit/07ba384a2d4e942e079733c32cb1d970e577d8e5))
* **mcp:** add bounded public research metadata reads ([9776269](https://github.com/planetaryescape/gbfm/commit/9776269ddb71ad1b291ec16441eea316be2ca824))
* **mcp:** add least-privilege admin publishing overview ([16f1de1](https://github.com/planetaryescape/gbfm/commit/16f1de17501d1b1a5a68bf5a377d428348d39ab6))
* **mcp:** add owner-bounded reminder reads ([23c93d7](https://github.com/planetaryescape/gbfm/commit/23c93d71d55707710190f62b4f3617102fd609fc))
* **mcp:** compose owner and admin reads with persisted OAuth ([8dbd4f4](https://github.com/planetaryescape/gbfm/commit/8dbd4f4863ddab00238f955913ca064629e7b321))
* **mcp:** compose public content reads with persisted OAuth ([af7c2be](https://github.com/planetaryescape/gbfm/commit/af7c2be60591f33e974515b767db4646de28863c))
* **mcp:** compose public research reads with persisted OAuth ([8beaa54](https://github.com/planetaryescape/gbfm/commit/8beaa546e279edf093238220ed2be6dbb4b616b9))
* **mcp:** establish scope-aware composition foundation ([2b97cf2](https://github.com/planetaryescape/gbfm/commit/2b97cf204c18ee2e22f21ed1a02782cfea532ef5))

# [2.127.0](https://github.com/planetaryescape/gbfm/compare/v2.126.0...v2.127.0) (2026-11-07)


### Bug Fixes

* **editorial:** recover conflicts without discarding the original tab ([b6ddf01](https://github.com/planetaryescape/gbfm/commit/b6ddf01c9773501f52376fdc2de04605a3eeea04))
* **editorial:** reject stale browser saves without losing local edits ([835c507](https://github.com/planetaryescape/gbfm/commit/835c5073d46cb64d3557ec7c3e47355538fa00a6))
* **mcp:** bound receipt replay and retain safe retry tombstones ([aee8731](https://github.com/planetaryescape/gbfm/commit/aee87313bd23d3cc08101e54e8ec50e3dca03d61))
* **mcp:** enforce scope-bound request sizes before parsing ([340f298](https://github.com/planetaryescape/gbfm/commit/340f298a673d43fa87cb9baafe42ef53a33688db))
* **mcp:** verify write limits and retain cleanup diagnostics ([ee3ba6b](https://github.com/planetaryescape/gbfm/commit/ee3ba6be7edb189e594582d44647c12c16d2ce54))


### Features

* **mcp:** add separately consented retry-safe draft writes ([9958337](https://github.com/planetaryescape/gbfm/commit/9958337fb3ecc5138414f69c99802d89b8b0e45e))

# [2.126.0](https://github.com/planetaryescape/gbfm/compare/v2.125.0...v2.126.0) (2026-11-06)


### Bug Fixes

* **oauth:** distinguish eligibility failures from other auth denials ([923acb0](https://github.com/planetaryescape/gbfm/commit/923acb0ac2f45749a8e768c42ef3f941a1b80d55))
* **oauth:** preserve session cookies throughout connection responses ([2ac8ae7](https://github.com/planetaryescape/gbfm/commit/2ac8ae73162f93e1e0cf783aeb5aaa46f2b11741))
* **oauth:** protect legacy connection redirects with no-referrer ([d9071f2](https://github.com/planetaryescape/gbfm/commit/d9071f244366db7389f5d6f52af18db80e5edfc6))
* **oauth:** reuse provider denial and configure signed-out cancellation ([015b9b2](https://github.com/planetaryescape/gbfm/commit/015b9b239ec2a1f0840880e1ffb6534d26eb0712))
* **oauth:** reuse website sessions and explain app connections ([20d58d4](https://github.com/planetaryescape/gbfm/commit/20d58d4eed4dee03c4871184b188cbfd72d4de23))
* **oauth:** tighten connection screen copy ([eaba2be](https://github.com/planetaryescape/gbfm/commit/eaba2be169d53972235dc5312995255e031c1a96))


### Features

* **oauth:** add brand wordmark and icons to connection screens ([a340ca2](https://github.com/planetaryescape/gbfm/commit/a340ca24a222e4342008d72cda00f8b8fbb3d938))


### Performance Improvements

* **oauth:** reject invalid actions before loading connection data ([166403a](https://github.com/planetaryescape/gbfm/commit/166403ac3ec96869a68eb8883b86ba2e05d67cf0))

# [2.125.0](https://github.com/planetaryescape/gbfm/compare/v2.124.1...v2.125.0) (2026-11-06)


### Bug Fixes

* **mcp:** route website guide directly to API Worker ([16da61e](https://github.com/planetaryescape/gbfm/commit/16da61ebf44e86a01f407ce683d17d2ea39d5e32))
* **mobile:** align task navigation and typography ([558535a](https://github.com/planetaryescape/gbfm/commit/558535af1fa48bc138601ead90c622182b820e0f))
* **mobile:** explain unavailable Spotify configuration ([f9c5223](https://github.com/planetaryescape/gbfm/commit/f9c5223e7de5ea3b05c707dbdd8ddbe14b2779e3))
* **mobile:** keep Settings readable at accessibility text sizes ([7bb4b7c](https://github.com/planetaryescape/gbfm/commit/7bb4b7cd74b7e0ea61cadc0b28b7fbaecb236d6c))
* **mobile:** synchronize native chrome with appearance preference ([891c48d](https://github.com/planetaryescape/gbfm/commit/891c48dd24dbf6fe33b54705c9a2e2c5e163c0a4))
* **www:** bypass asset classification for MCP guide ([9f8404d](https://github.com/planetaryescape/gbfm/commit/9f8404d665c405350c8d3122c6485e929fa832f1))


### Features

* **mobile:** organize settings into focused subpages ([bf60582](https://github.com/planetaryescape/gbfm/commit/bf60582655498401115f77af9cfc6230d538fe4f))

## [2.124.1](https://github.com/planetaryescape/gbfm/compare/v2.124.0...v2.124.1) (2026-11-06)


### Bug Fixes

* **www:** route MCP guide before static assets ([75a89cf](https://github.com/planetaryescape/gbfm/commit/75a89cf99fa7d01aacfc6feea93285ea1c73b8e2))

# [2.124.0](https://github.com/planetaryescape/gbfm/compare/v2.123.0...v2.124.0) (2026-11-06)


### Features

* **mcp:** serve plain-text connection instructions ([61a7390](https://github.com/planetaryescape/gbfm/commit/61a739004b0f5ede29ab0479005e8b136318487e))

# [2.123.0](https://github.com/planetaryescape/gbfm/compare/v2.122.2...v2.123.0) (2026-11-04)


### Bug Fixes

* **ci:** bound D1 workers and use preinstalled fixture browsers ([51879bd](https://github.com/planetaryescape/gbfm/commit/51879bd289d09b8dfb717670c215276337093a8c))
* **ci:** expose Bun package runner to browser fixtures ([bfc9284](https://github.com/planetaryescape/gbfm/commit/bfc928423cf910c954a57576fc1dece3f12b49da))
* **ci:** install Bun archive dependency in browser container ([beb37e9](https://github.com/planetaryescape/gbfm/commit/beb37e97fbd0239914a2264da90a5a62a8945fcc))
* **ci:** isolate browser tests from host toolchain setup ([d914540](https://github.com/planetaryescape/gbfm/commit/d9145407d4c6cd90d6f55ca590a7ebe50d7f5175))
* **mcp:** address OAuth and editorial review findings ([c9bfee9](https://github.com/planetaryescape/gbfm/commit/c9bfee9667e0cf68f8f933c02d92f7a7ab4e9914))
* **mcp:** resolve deployed origins and keep revocation available ([a51a91f](https://github.com/planetaryescape/gbfm/commit/a51a91f53780d7d597ca0dd9bfd0f6a09f1a9cdc))


### Features

* **mcp:** add owner-only OAuth and read-only editorial tools ([72dd3a0](https://github.com/planetaryescape/gbfm/commit/72dd3a0d42856f77e22c16f1162ff6d5105862f8))

## [2.122.2](https://github.com/planetaryescape/gbfm/compare/v2.122.1...v2.122.2) (2026-11-04)


### Bug Fixes

* **accounts:** preserve preferences across competing creation ([f53567a](https://github.com/planetaryescape/gbfm/commit/f53567ac0fab8c3ca9f94dd8f9c7b0ba20c96500))
* **accounts:** preserve preferences across competing creation ([cc55e27](https://github.com/planetaryescape/gbfm/commit/cc55e272feea820d187f4655ae7f11db47098a71))
* **accounts:** preserve unsubscribe consent across repeats ([4558515](https://github.com/planetaryescape/gbfm/commit/45585152c77f06f424725cbd7fdba30308d5c7b5))
* **accounts:** preserve unsubscribe consent across repeats ([4ff6d4f](https://github.com/planetaryescape/gbfm/commit/4ff6d4f679f884be2832446c16ebd9e9d56ad484))
* **composer:** distinguish refusals and allow explicit receipt recovery ([ee64504](https://github.com/planetaryescape/gbfm/commit/ee6450462011344c1e16c543f5349fa4c73fdc4a))
* **creator:** fence remote saves and preserve newer local drafts ([d2b9bc8](https://github.com/planetaryescape/gbfm/commit/d2b9bc896ad209b3a3a607e4ea9d9bbb902ad55e))
* **creator:** fence remote saves and preserve newer local drafts ([43c95d9](https://github.com/planetaryescape/gbfm/commit/43c95d9772da6d28d1beff44b76bbc2f78ce4404))
* **creator:** reconcile latest edits and fence stale failures ([599479a](https://github.com/planetaryescape/gbfm/commit/599479a392a6d0117173a30e12b6b6585901720c))
* **creator:** reconcile latest edits and fence stale failures ([c1901d8](https://github.com/planetaryescape/gbfm/commit/c1901d8d8bba860d35c078c95f8b4ef75f5cdbbd))
* **mobile:** own login and reader request lifetimes ([0082262](https://github.com/planetaryescape/gbfm/commit/0082262475f3a23fd04af1e368f04a6242b51543))
* **mobile:** own login and reader request lifetimes ([0a2aef1](https://github.com/planetaryescape/gbfm/commit/0a2aef11b2f4c8dd514b4d824e3f3fe123863dd3))
* **mobile:** persist composer publication recovery receipts ([d353d34](https://github.com/planetaryescape/gbfm/commit/d353d34a521d4867f16294eea0bc1c9ef36101f8))
* **mobile:** serialize owned auth storage commits ([51548e7](https://github.com/planetaryescape/gbfm/commit/51548e7240d109ec9fb55bda4ee6f2dee297efb4))
* **player:** bound hydration recovery during shutdown ([ca01c35](https://github.com/planetaryescape/gbfm/commit/ca01c35391acbdb32fa6b2189ace5aa836eb7d81))
* **player:** own audio instances and subscriptions per source ([6b14918](https://github.com/planetaryescape/gbfm/commit/6b149184b1676e839e080e208fa73a0264b5bf43))
* **player:** preserve unread volume after hydration failure ([78ca8a5](https://github.com/planetaryescape/gbfm/commit/78ca8a5a2d808cbdabc65dc6115bdf5b6302b90c))
* **publication:** preserve creators when replacement fails ([bf4e40f](https://github.com/planetaryescape/gbfm/commit/bf4e40fb383ce47db3cc27b8c2c1ea6d0c2ea44f))
* **publication:** preserve creators when replacement fails ([c66be95](https://github.com/planetaryescape/gbfm/commit/c66be95b5a6e87b324ad8e04ec687b527e8b8243))
* **reminders:** invalidate claims when schedules change ([2c6b186](https://github.com/planetaryescape/gbfm/commit/2c6b18643fe55c3cac4700ee47841b84c4038678))
* **reminders:** recover stale queue work with fenced claims ([9b65bb8](https://github.com/planetaryescape/gbfm/commit/9b65bb86224e4775160f7a78fc972bc996009ed5))
* **runtimes:** fence stale telemetry, signup and toast callbacks ([5407d71](https://github.com/planetaryescape/gbfm/commit/5407d711953389feb2a15c3cb1db4f0b83769e7e))
* **runtimes:** fence stale telemetry, signup and toast callbacks ([7b39cab](https://github.com/planetaryescape/gbfm/commit/7b39cab4bac2344b3db49ce61195bdfca037bab5))
* **spotify:** fence connection and entity operation lifetimes ([14a8127](https://github.com/planetaryescape/gbfm/commit/14a8127391eee7ba41a2e4c233789334062a6c03))
* **spotify:** fence connection and entity operation lifetimes ([6561c59](https://github.com/planetaryescape/gbfm/commit/6561c59551d58c7e04af57d2487d9fdf98963c40))
* **spotify:** recheck queued owners and fence refreshed sessions ([cd905b5](https://github.com/planetaryescape/gbfm/commit/cd905b518335993a18f8c76ee4ec237776003ae7))
* **www:** preserve Foldkit initialization contract for Spotify SSR ([706ae9a](https://github.com/planetaryescape/gbfm/commit/706ae9ad58e177a641b36fa27bb150c6b6e59361))
* **www:** preserve Foldkit initialization for Spotify SSR ([#500](https://github.com/planetaryescape/gbfm/issues/500)) ([0b5a4bb](https://github.com/planetaryescape/gbfm/commit/0b5a4bb86bf9d51637beaacee364bf161b84b429))

## [2.122.1](https://github.com/planetaryescape/gbfm/compare/v2.122.0...v2.122.1) (2026-11-04)


### Bug Fixes

* **www:** attach reader telemetry to the real document host ([a781336](https://github.com/planetaryescape/gbfm/commit/a781336db4c0f7466f5ecc047095c30555f95088))

# [2.122.0](https://github.com/planetaryescape/gbfm/compare/v2.121.3...v2.122.0) (2026-11-04)


### Bug Fixes

* **build:** refuse public source maps after authenticated upload ([5cb05a4](https://github.com/planetaryescape/gbfm/commit/5cb05a4be7cedb393de99560b998558b4fea9506))
* **mobile:** bind observability consumers to the active provider lifetime ([0fe2e3d](https://github.com/planetaryescape/gbfm/commit/0fe2e3d189bc1e6020c5c660be08a9ba92206034))
* **mobile:** initialize observability before Router evaluation ([083d248](https://github.com/planetaryescape/gbfm/commit/083d248a48a67a28f2c2b82c31c2ccbbca1290db))
* **observability:** isolate signals and own in-flight journey admission ([c628d66](https://github.com/planetaryescape/gbfm/commit/c628d6624b715f40c6ba36b3371f002e905a0173))


### Features

* **mobile:** establish privacy-bounded Sentry observability ([85de466](https://github.com/planetaryescape/gbfm/commit/85de466bd1940732091d8a84dc332e85216caed4))
* **mobile:** observe reading and native playback outcomes ([e74c334](https://github.com/planetaryescape/gbfm/commit/e74c334591d236a810ddb1fdf1ff83ddc3d14049))
* **observability:** align web journeys and gate capture on source-map uploads ([c8d825f](https://github.com/planetaryescape/gbfm/commit/c8d825fffdb2b99f47db459a66dfa909a8dab061))
* **www:** observe browser navigation through shared Effect services ([290a57f](https://github.com/planetaryescape/gbfm/commit/290a57f4df1a3b9901a7ddd8420ad1408c2507e6))

## [2.121.3](https://github.com/planetaryescape/gbfm/compare/v2.121.2...v2.121.3) (2026-11-04)


### Bug Fixes

* **uploads:** preserve replacement ownership and confirmed completion ([ffaadec](https://github.com/planetaryescape/gbfm/commit/ffaadec8fe3841b4d6b5e2ac542a09e98cd73481))
* **uploads:** preserve replacement ownership and confirmed completion ([#485](https://github.com/planetaryescape/gbfm/issues/485)) ([ce56be7](https://github.com/planetaryescape/gbfm/commit/ce56be7522bf0b6f6e64386e717c78ef859527c5))

## [2.121.2](https://github.com/planetaryescape/gbfm/compare/v2.121.1...v2.121.2) (2026-11-04)


### Bug Fixes

* **api-keys:** discard issuance secrets after pagehide ([d6d6ff4](https://github.com/planetaryescape/gbfm/commit/d6d6ff4e49c7af85a4510de21a0d6f454efa692c))
* **api-keys:** recover cleared confirmation failures ([6693ba5](https://github.com/planetaryescape/gbfm/commit/6693ba52ce9903bca3b43e541009aba41800adcb))
* **server:** fence playlist and navigation writes by attempt ownership ([eccaf03](https://github.com/planetaryescape/gbfm/commit/eccaf0324fd8a9c4f1d311ca088e9c4bcb3a6ac7))

## [2.121.1](https://github.com/planetaryescape/gbfm/compare/v2.121.0...v2.121.1) (2026-11-04)


### Bug Fixes

* **api-keys:** make issuance generator exits explicit ([affdf4a](https://github.com/planetaryescape/gbfm/commit/affdf4a800fb334288f5499d311d8c12f451e17a))
* **auth:** ignore validation results from superseded restores ([af3c2a9](https://github.com/planetaryescape/gbfm/commit/af3c2a91133aa1155f701aeac67cd285bf223763))
* **dashboard:** report show operations accurately and verify playlist reloads ([040c6dc](https://github.com/planetaryescape/gbfm/commit/040c6dc91a7a6283c49dbe7eeaabfaa4d5ca3584))
* **mobile:** guard uncertain replies and composer navigation ([db9f8c6](https://github.com/planetaryescape/gbfm/commit/db9f8c691dc80c36f48fb06d74927c67acebd646))
* **mobile:** make published composer cleanup read-only ([e5a8102](https://github.com/planetaryescape/gbfm/commit/e5a8102459db197e3b6b29816b71651fe74a008e))
* **mobile:** retry composer cleanup without duplicate content ([30d23f1](https://github.com/planetaryescape/gbfm/commit/30d23f1e66e8491c726955c5154b2c2a95f83c61))
* **preview:** make session disposal terminal ([c55a9e5](https://github.com/planetaryescape/gbfm/commit/c55a9e5e5dd66f5c4f7d55fb81a11b2d73210ffd))
* **reader:** short-circuit pending visits and verify identity guards ([e083258](https://github.com/planetaryescape/gbfm/commit/e083258b00db9bbd582bbc309355dfb51e336cc4))
* **reminders:** deliver post-claim edits from the fresh row ([edd0e7d](https://github.com/planetaryescape/gbfm/commit/edd0e7db61b7cdff1d465825c597fc8074d70b68))
* **reminders:** keep post-claim read failures retryable ([036eb73](https://github.com/planetaryescape/gbfm/commit/036eb73ed68b83eca93ac6f83e050397a5ae86f6))
* **signup:** recover preparation failures and guard disposed retries ([99a8d19](https://github.com/planetaryescape/gbfm/commit/99a8d19196963b12b2441178e1d06e61c232e7f1))

# [2.121.0](https://github.com/planetaryescape/gbfm/compare/v2.120.0...v2.121.0) (2026-11-03)


### Bug Fixes

* **mobile:** keep short tweets swipeable and show navigation readiness ([20d2234](https://github.com/planetaryescape/gbfm/commit/20d223415bcb1f9c48dfd3f028ddfc3692b33f0f))
* **mobile:** keep tweet gestures anchored and content visible while loading ([fd9e4e0](https://github.com/planetaryescape/gbfm/commit/fd9e4e01854b13167d6a3610942e5387e42e81d1))
* **mobile:** reject reading actions from inactive readers ([e09b734](https://github.com/planetaryescape/gbfm/commit/e09b7349217c176275393cee5813541d2dd35c70))
* **mobile:** retain session roles and wait for auth restoration ([bcc08d2](https://github.com/planetaryescape/gbfm/commit/bcc08d25fe43e4ac314d020403169f2bf3866065))
* **www:** confirm API key creation with a password dialog ([07beb55](https://github.com/planetaryescape/gbfm/commit/07beb554e1e97de78f28430dc2954bdcbd028f9b))
* **www:** give archive months consistent touch-sized controls ([14f022f](https://github.com/planetaryescape/gbfm/commit/14f022f31e1225b5e3649e0c2ca4cc1a672a53dd))
* **www:** hold the current tweet on screen until its replacement arrives ([c7773ae](https://github.com/planetaryescape/gbfm/commit/c7773aebd24e4699b0d4909220db1d28280760cd))
* **www:** keep 1Password popups interactive during key confirmation ([84cb766](https://github.com/planetaryescape/gbfm/commit/84cb766dc72777508abdaa8e8192a92ce0cee646))
* **www:** keep tweet prose readable in manual dark mode ([56da3c7](https://github.com/planetaryescape/gbfm/commit/56da3c7ad07a1141bd9bb4457af484dabbfe95c6))
* **www:** let shared .btn styles apply inside the dashboard ([c52626a](https://github.com/planetaryescape/gbfm/commit/c52626a1de22e2b12920110395944bf30a517e43))
* **www:** persist account-scoped tweet positions across restarts ([3ae9dec](https://github.com/planetaryescape/gbfm/commit/3ae9dec5221e61bca0787543bb7d2b56c859e4c7))
* **www:** prevent autofill interactions dismissing password confirmation ([7e7790a](https://github.com/planetaryescape/gbfm/commit/7e7790a737b4dc027fa5cb7f59d3470b1d64c9f6))


### Features

* **design:** share geometry and button roles across platforms ([662c6ad](https://github.com/planetaryescape/gbfm/commit/662c6ad4cd42d8e61bddaab67545461736ed6552))
* **mobile:** add compose tab access and refine playback styling ([93125d5](https://github.com/planetaryescape/gbfm/commit/93125d554b5c593a28e5a6b640ad2a06d208c370))
* **mobile:** add paged reading, replies and persistent progress ([c8e8ffc](https://github.com/planetaryescape/gbfm/commit/c8e8ffc1d3f39ad4294d958d36a276c979935974))
* **mobile:** add shared haptic feedback ([efc9437](https://github.com/planetaryescape/gbfm/commit/efc943728f3781d1c3d31d5c50f15313e7290f04))
* **mobile:** align tweet reading and navigation with web ([3b78d51](https://github.com/planetaryescape/gbfm/commit/3b78d51408d069d9e94c4d273ca421533ec7f8ca))
* **mobile:** browse tweet previews with separate date filters ([a118da3](https://github.com/planetaryescape/gbfm/commit/a118da323aca56f0ee3e10088084dd62533c64ab))
* **mobile:** compose tweets from saved drafts and incoming shares ([6729342](https://github.com/planetaryescape/gbfm/commit/67293420cc4f5d2e426054042b80e185ec8037f8))
* **mobile:** declutter tweet reading with swipe navigation ([45bd601](https://github.com/planetaryescape/gbfm/commit/45bd601f1385338a28fd04e6291efbd8eabd6d2e))
* **mobile:** make tweet swipes track the finger on the UI thread ([a191603](https://github.com/planetaryescape/gbfm/commit/a191603e8a3e4a2100abbdd6846fdae47a659902))
* **mobile:** unify tweet composition with tags, editing and replies ([bfac222](https://github.com/planetaryescape/gbfm/commit/bfac2227a0ba1736a7ff3b48557e298c24b83e87))
* **mobile:** use custom angular navigation and playback icons ([f20ee37](https://github.com/planetaryescape/gbfm/commit/f20ee374d04135e49303d6734373b3d81b542807))
* **reader:** accept swipes by distance and recent release velocity ([435e8e2](https://github.com/planetaryescape/gbfm/commit/435e8e2a6b4eeebf62472d7aad1073bf78a8eebf))
* **reader:** replace timeline browsing with deliberate month visits ([969ef04](https://github.com/planetaryescape/gbfm/commit/969ef04e20a1c933a95c5e22c72fc34bc228f784))
* **www:** animate tweet dragging, snap-back, and swipe transitions ([98b533e](https://github.com/planetaryescape/gbfm/commit/98b533ea18fd922e041dffae2d6da89510860a12))
* **www:** browse tweet previews beside the swipe reader ([49d79d8](https://github.com/planetaryescape/gbfm/commit/49d79d8213ee1db43abf841979b4df50e35ab888))
* **www:** manage personal API keys from settings ([9765b12](https://github.com/planetaryescape/gbfm/commit/9765b12f907dc10074fb7247b313ae606b4cd5ed))
* **www:** simplify reader chrome and add touch navigation ([3958ea1](https://github.com/planetaryescape/gbfm/commit/3958ea14de0a803f19467d807c57472291c7fac6))
* **www:** surface newer unread tweets and keep a return point ([b1c989b](https://github.com/planetaryescape/gbfm/commit/b1c989ba4be5df56b67bd34de796301ccb916c9a))

# [2.120.0](https://github.com/planetaryescape/gbfm/compare/v2.119.0...v2.120.0) (2026-11-01)


### Bug Fixes

* **reader:** recover navigation and narrow gesture exclusions ([6a7d78c](https://github.com/planetaryescape/gbfm/commit/6a7d78c8ce10e45a498f55f29e2230b7d6e85551))


### Features

* **reader:** add cross-platform swipe and month visits ([05b9bc7](https://github.com/planetaryescape/gbfm/commit/05b9bc774a24717d0738388fdcdfcd489d527882))

# [2.119.0](https://github.com/planetaryescape/gbfm/compare/v2.118.0...v2.119.0) (2026-11-01)


### Bug Fixes

* **auth:** close scoped-key review gaps ([9221ff7](https://github.com/planetaryescape/gbfm/commit/9221ff7d1eafbcff088264c6dda95405647efd10))
* **auth:** keep admission specs and race gates precise ([cd73ec5](https://github.com/planetaryescape/gbfm/commit/cd73ec5b1c05524a4918ab6039a91cf20f15cbf9))
* **auth:** parse branded actor identities at auth boundaries ([44adce1](https://github.com/planetaryescape/gbfm/commit/44adce1eeb954130aa25debc4fc1e66a8c7dfda4))
* **auth:** preserve key domain contracts through management flows ([a5ee534](https://github.com/planetaryescape/gbfm/commit/a5ee5343d085c7d892066d38f9c75be93f214931))
* **design:** expose selection and require artwork in checks ([1ec84ff](https://github.com/planetaryescape/gbfm/commit/1ec84ff2b942c43db63855d19a6a264bd8c60523))
* **design:** preserve control overrides and square artwork ([c0cf0d1](https://github.com/planetaryescape/gbfm/commit/c0cf0d1d496080e88800c8432e3381bdfa587ae9))


### Features

* **auth:** add scoped personal access keys for post authoring ([4f1e88c](https://github.com/planetaryescape/gbfm/commit/4f1e88c390199555dbc8394fd514ce1cb21cc60b))
* **design:** share controls and simplify player chrome ([141e218](https://github.com/planetaryescape/gbfm/commit/141e218309fd62d436c95cff8fb6d849249d5cb2))

# [2.118.0](https://github.com/planetaryescape/gbfm/compare/v2.117.0...v2.118.0) (2026-11-01)


### Features

* **artwork:** generate saved mosaics from post media ([0638487](https://github.com/planetaryescape/gbfm/commit/0638487daf16c4e4c98d27192acff151a963a323))

# [2.117.0](https://github.com/planetaryescape/gbfm/compare/v2.116.0...v2.117.0) (2026-10-30)


### Features

* **editorial:** let authors read their drafts ([ff29dbf](https://github.com/planetaryescape/gbfm/commit/ff29dbf7ffd0cb87955c18e1399710cab6018ac6))

# [2.116.0](https://github.com/planetaryescape/gbfm/compare/v2.115.3...v2.116.0) (2026-10-29)


### Bug Fixes

* **mobile:** confirm session expiry before favorite recovery ([7ab0540](https://github.com/planetaryescape/gbfm/commit/7ab0540df94f397eb8170189185e602b1f49a4cd))
* **mobile:** keep the player close control clear of its header ([b0875ac](https://github.com/planetaryescape/gbfm/commit/b0875ac9f38ecbf6190a75c6d2aa153005110ea2))
* **mobile:** preserve light-mode titles and show screen insets ([ad9b71d](https://github.com/planetaryescape/gbfm/commit/ad9b71dfd091b84d8a585c2f21a3c85c67bb6637))
* **mobile:** preserve link destinations on inline tweet images ([a926f29](https://github.com/planetaryescape/gbfm/commit/a926f29d84b8ddedfe350e468cf4aa85535ecfbe))
* **mobile:** recognize Better Auth null session responses ([207a70f](https://github.com/planetaryescape/gbfm/commit/207a70f4385292392a51d7aa71ea9fb4a7de6b52))
* **player:** show favorite errors as toasts with stepped hearts ([0b31098](https://github.com/planetaryescape/gbfm/commit/0b31098dea8f90690183244b0b14ec8813787527))
* **www:** adopt floating Apple Music-style playback controls ([73e7168](https://github.com/planetaryescape/gbfm/commit/73e7168e7ab7ebcb82ad1ae0b4954c562799366c))
* **www:** bind favorite results to their request and account ([1c9f717](https://github.com/planetaryescape/gbfm/commit/1c9f717ce95b532db5546bb2141cf353a8c06454))
* **www:** clarify mobile playback and match safe-area colours ([72da03c](https://github.com/planetaryescape/gbfm/commit/72da03cde9a93e45853c5c86ddae164751212be6))
* **www:** make Home the first mobile navigation tab ([48d6659](https://github.com/planetaryescape/gbfm/commit/48d6659b5e2eeea1a98d8ce4efcf65f29d4f726d))
* **www:** preserve favorite saves over late page responses ([e6749f3](https://github.com/planetaryescape/gbfm/commit/e6749f3dfe5ceba027c08699aef32b7900bb376a))
* **www:** retain pending favorites across same-track navigation ([d7ab972](https://github.com/planetaryescape/gbfm/commit/d7ab9729d387adcf4be2c6ea7e6392452ed50973))
* **www:** soften scrolling behind the mobile dock ([5296cc8](https://github.com/planetaryescape/gbfm/commit/5296cc88c104a5d27fca72e4e5b2455c4adfefbd))


### Features

* **api:** include batched music cards in the tweet feed ([7a526ac](https://github.com/planetaryescape/gbfm/commit/7a526acda7edb6ca6eb679c0fc75f59d8679392a))
* **mobile:** browse tweets and reply threads ([600e253](https://github.com/planetaryescape/gbfm/commit/600e253533d985071ac05d4dc6dbdbf3b7d87510))
* **mobile:** favorite the current track from Now Playing ([3ea54ed](https://github.com/planetaryescape/gbfm/commit/3ea54ed1adaabe6158f49028860422cdbe3b37eb))
* **mobile:** render tweet music and media directly in the feed ([fcb3612](https://github.com/planetaryescape/gbfm/commit/fcb3612cdd63a036802cc468cbd5d02357eae13d))
* **www:** favorite the queued track from the expanded player ([0570fdc](https://github.com/planetaryescape/gbfm/commit/0570fdc28e889d7f0755c271584b8dda641c55fd))
* **www:** redraw contextual icons and clarify dock expansion ([bd2b654](https://github.com/planetaryescape/gbfm/commit/bd2b65462ee68857cdcdcb9eb54b37f8ec494d37))

## [2.115.3](https://github.com/planetaryescape/gbfm/compare/v2.115.2...v2.115.3) (2026-10-28)


### Performance Improvements

* **editorial:** fix slow reloads with summary-only list reads ([#412](https://github.com/planetaryescape/gbfm/issues/412)) ([f90f0ac](https://github.com/planetaryescape/gbfm/commit/f90f0acbf7da729e5b08aaba5534a7f6838fa1c9))

## [2.115.2](https://github.com/planetaryescape/gbfm/compare/v2.115.1...v2.115.2) (2026-10-27)


### Performance Improvements

* **api:** cache public editorial lists for repeat reads ([#408](https://github.com/planetaryescape/gbfm/issues/408)) ([f62b207](https://github.com/planetaryescape/gbfm/commit/f62b207313fc435c5d02a3d590762431b5fc534e))

## [2.115.1](https://github.com/planetaryescape/gbfm/compare/v2.115.0...v2.115.1) (2026-10-26)


### Bug Fixes

* **nav:** keep Collections discoverable only to admins ([#406](https://github.com/planetaryescape/gbfm/issues/406)) ([0c2c8f0](https://github.com/planetaryescape/gbfm/commit/0c2c8f0d8b5a66d6038c9a5ac7c5686a65e87524))

# [2.115.0](https://github.com/planetaryescape/gbfm/compare/v2.114.1...v2.115.0) (2026-10-26)


### Features

* **content:** redesign embedded music cards and track lists ([#405](https://github.com/planetaryescape/gbfm/issues/405)) ([0338a26](https://github.com/planetaryescape/gbfm/commit/0338a264176e9ab1148ed8e0c63eb50ab4c3cfc5))

## [2.114.1](https://github.com/planetaryescape/gbfm/compare/v2.114.0...v2.114.1) (2026-10-26)


### Bug Fixes

* **content:** let artwork-free music cards fill their width ([#403](https://github.com/planetaryescape/gbfm/issues/403)) ([602a275](https://github.com/planetaryescape/gbfm/commit/602a275f725e77902468f98d08f8a87c9678b234))

# [2.114.0](https://github.com/planetaryescape/gbfm/compare/v2.113.1...v2.114.0) (2026-10-26)


### Bug Fixes

* **media:** diagnose unavailable Bandcamp players safely ([#401](https://github.com/planetaryescape/gbfm/issues/401)) ([e37e41f](https://github.com/planetaryescape/gbfm/commit/e37e41f3854696fa223dfb98f557a4e6ade26402))


### Features

* **creator:** show previous tweets for attached music ([#402](https://github.com/planetaryescape/gbfm/issues/402)) ([a5b7e67](https://github.com/planetaryescape/gbfm/commit/a5b7e671e01485e6c2d886781fd9974625aa9006))

## [2.113.1](https://github.com/planetaryescape/gbfm/compare/v2.113.0...v2.113.1) (2026-10-26)


### Bug Fixes

* **creator:** align preview, publishing and author selection ([#399](https://github.com/planetaryescape/gbfm/issues/399)) ([55dcfb4](https://github.com/planetaryescape/gbfm/commit/55dcfb4d1ae8804bf9817ec9d9ca578c542e65f0))

# [2.113.0](https://github.com/planetaryescape/gbfm/compare/v2.112.2...v2.113.0) (2026-10-26)


### Features

* **posts:** resolve music for individual saved posts ([#398](https://github.com/planetaryescape/gbfm/issues/398)) ([c39da23](https://github.com/planetaryescape/gbfm/commit/c39da23a7ac67523c027778ea9307fc0eb677acd))

## [2.112.2](https://github.com/planetaryescape/gbfm/compare/v2.112.1...v2.112.2) (2026-10-26)


### Bug Fixes

* **www:** restore Spotify controls on tweet music cards ([#397](https://github.com/planetaryescape/gbfm/issues/397)) ([53b6fba](https://github.com/planetaryescape/gbfm/commit/53b6fbafa52f50efdfa2d0db2ec3bf0737157849))

## [2.112.1](https://github.com/planetaryescape/gbfm/compare/v2.112.0...v2.112.1) (2026-10-25)


### Bug Fixes

* **www:** restore upload controls and browser regression coverage ([0a983d2](https://github.com/planetaryescape/gbfm/commit/0a983d28fa92a42f7b8ad97e3754e3782b110a8f))

# [2.112.0](https://github.com/planetaryescape/gbfm/compare/v2.111.2...v2.112.0) (2026-10-25)


### Features

* **listening:** build a focused listening desk and public journal ([fd9b261](https://github.com/planetaryescape/gbfm/commit/fd9b261112a85486fc9e3ff4ff1eb31a113d4089))
* **listening:** save mixes and publish annotated collections ([83bc152](https://github.com/planetaryescape/gbfm/commit/83bc152f899c5a22595b8b4a053f21aa2f0530a4))

## [2.111.2](https://github.com/planetaryescape/gbfm/compare/v2.111.1...v2.111.2) (2026-10-25)


### Bug Fixes

* **media:** protect new uploads without rotating playback URLs ([4cc49e3](https://github.com/planetaryescape/gbfm/commit/4cc49e3e1cde8056633e928b1fd4bf5256cc73a1))
* **media:** sandbox uploads and cancel superseded playback ([b1ed3df](https://github.com/planetaryescape/gbfm/commit/b1ed3df7954f8f4d26db360c12111773f879891f))
* **public-actions:** give subscribe and favorite buttons an icon and quiet pressed state ([ebb9ee0](https://github.com/planetaryescape/gbfm/commit/ebb9ee044ddc16720fcbe601bb1cb559cb95aa6e))
* **shows:** tighten masthead rhythm and pin actions to art baseline ([48fca9e](https://github.com/planetaryescape/gbfm/commit/48fca9e7aa5b97b77e0045d435765c22edad697e))

## [2.111.1](https://github.com/planetaryescape/gbfm/compare/v2.111.0...v2.111.1) (2026-10-25)


### Bug Fixes

* **shows:** group read more with the blurb and quiet it ([1485768](https://github.com/planetaryescape/gbfm/commit/14857683592a5931d95d21b4db838da4eb403fa4))

# [2.111.0](https://github.com/planetaryescape/gbfm/compare/v2.110.0...v2.111.0) (2026-10-25)


### Bug Fixes

* **profiles:** use compact artwork rows and branded platform links ([aa85275](https://github.com/planetaryescape/gbfm/commit/aa852754e93ab2441d7a2fd2a83f676466a7072b))
* **shows:** pin the about panel header and animate it open ([5fa0794](https://github.com/planetaryescape/gbfm/commit/5fa079410ce9b978124862981e6d2d59da411722))
* **shows:** tighten about the show typography ([bf1be09](https://github.com/planetaryescape/gbfm/commit/bf1be095612b2e7247e40016b3453d77a4f3fe8a))
* **shows:** top-align masthead art with the title ([9b42190](https://github.com/planetaryescape/gbfm/commit/9b42190fe6110a1825b409dd317aef37dd5da000))


### Features

* **shows:** link host mentions in the show write-up ([c81df88](https://github.com/planetaryescape/gbfm/commit/c81df88bbde4b9b984d38d3f434b476ae8d90d86))
* **shows:** move the about blurb into the show masthead ([4c0b698](https://github.com/planetaryescape/gbfm/commit/4c0b6982273644f3c2625eb3722aaf5bc5166e23))
* **shows:** show an about blurb with a full write-up panel ([3cce0e9](https://github.com/planetaryescape/gbfm/commit/3cce0e90f5e90d7aff30d803c24b5f454a33dd7d))

# [2.110.0](https://github.com/planetaryescape/gbfm/compare/v2.109.0...v2.110.0) (2026-10-25)


### Bug Fixes

* **profiles:** show drafts to admins and mix managers ([fabfd9c](https://github.com/planetaryescape/gbfm/commit/fabfd9cfefd75be42485025c00a6f57ca2fb1c25))


### Features

* **shows:** link DJ credits on episode rows ([97dbdcd](https://github.com/planetaryescape/gbfm/commit/97dbdcded30175f96695bff1375137ca01f36099))
* **shows:** move about the show beside episodes ([e4d8986](https://github.com/planetaryescape/gbfm/commit/e4d89862a23f2ace516ac165dadd285d8443282a))

# [2.109.0](https://github.com/planetaryescape/gbfm/compare/v2.108.1...v2.109.0) (2026-10-25)


### Features

* **djs:** support artist identities and separate mix credits ([13321cf](https://github.com/planetaryescape/gbfm/commit/13321cfab04a3889de0b5024ced2da691efa0194))

## [2.108.1](https://github.com/planetaryescape/gbfm/compare/v2.108.0...v2.108.1) (2026-10-25)


### Bug Fixes

* **upload:** normalize R2 multipart ETags for completion ([f2b5784](https://github.com/planetaryescape/gbfm/commit/f2b5784487af86b5e6f609ce189171d6b19c3172))

# [2.108.0](https://github.com/guidefari/gbfm/compare/v2.107.3...v2.108.0) (2026-10-25)


### Features

* **www:** restyle email updates page and invite readers after mixes and articles ([499ef39](https://github.com/guidefari/gbfm/commit/499ef395954450d689f030b9746227eae1d34370))

## [2.107.3](https://github.com/guidefari/gbfm/compare/v2.107.2...v2.107.3) (2026-10-25)


### Bug Fixes

* **seo:** identify gbfm and artists in public metadata ([80dc66f](https://github.com/guidefari/gbfm/commit/80dc66f1c145e8950c9dbdc2c6c458cf22db6173))
* **www:** preserve homepage design and original description ([191866b](https://github.com/guidefari/gbfm/commit/191866b91b1a039a9ec536e7816b03766a0f2061))

## [2.107.2](https://github.com/guidefari/gbfm/compare/v2.107.1...v2.107.2) (2026-10-25)


### Bug Fixes

* **signup:** block automated newsletter and account registrations ([f48fabf](https://github.com/guidefari/gbfm/commit/f48fabff1b9ef7c26f3c3526f119a50bcc81fd97))
* **signup:** diagnose verifier failures and cancel interrupted requests ([6cfa310](https://github.com/guidefari/gbfm/commit/6cfa31033ed96803a058a103fd2129ab54a034d7))

## [2.107.1](https://github.com/guidefari/gbfm/compare/v2.107.0...v2.107.1) (2026-10-24)


### Bug Fixes

* **www:** address Lighthouse accessibility and initial JS findings ([#387](https://github.com/guidefari/gbfm/issues/387)) ([71cd4af](https://github.com/guidefari/gbfm/commit/71cd4af2bc0c70a04d72f346ec1e5dba1d800e8c))


### Performance Improvements

* **www:** reduce initial JavaScript and font loading ([#388](https://github.com/guidefari/gbfm/issues/388)) ([cb28d6d](https://github.com/guidefari/gbfm/commit/cb28d6d6bcfbecd1fb577280d7150ecf91539ad5))
* **www:** serve the default cover locally without pixel loss ([#390](https://github.com/guidefari/gbfm/issues/390)) ([b9a846d](https://github.com/guidefari/gbfm/commit/b9a846dc5a5807538d93c37f0195da7d68bdcdf0))

# [2.107.0](https://github.com/guidefari/gbfm/compare/v2.106.0...v2.107.0) (2026-10-24)


### Bug Fixes

* **deps:** restore effect-tsgo platform packages in the lockfile ([7ffa150](https://github.com/guidefari/gbfm/commit/7ffa15091d0dee26eaef18194130d5425304bfc5))
* **www:** drop the unreachable Home dashboard tab ([d829197](https://github.com/guidefari/gbfm/commit/d8291976871b7247ab218a3c758d9cc488158d51))
* **www:** keep monospace column styling out of table headers ([634d83b](https://github.com/guidefari/gbfm/commit/634d83b10eea5d305db927c7fa5163ed7d22bcd3))
* **www:** keep the Spotify import form within phone width ([ff5b75b](https://github.com/guidefari/gbfm/commit/ff5b75bfc2f0a524a96e33272cc5d180dd567483))


### Features

* **www:** link forbidden dashboard pages back to the dashboard ([a3cc163](https://github.com/guidefari/gbfm/commit/a3cc163252aeb8a2a79fc6f1f4d965fb68837ba4))

# [2.106.0](https://github.com/guidefari/gbfm/compare/v2.105.0...v2.106.0) (2026-10-23)


### Bug Fixes

* **dev:** isolate local Alchemy state from cloud deployments ([96a08b2](https://github.com/guidefari/gbfm/commit/96a08b2b41eb73037414bc3e835491f73e0300d5))
* **server:** land email verification on the verify-email page ([3cde072](https://github.com/guidefari/gbfm/commit/3cde0726037624a534d6080ab4523c410f225ec6))
* **server:** resolve the database tracer per query ([e558275](https://github.com/guidefari/gbfm/commit/e5582751d4c0f82a0ed7d5055d241b131458f43b))
* **www:** bring the dashboard down to a compact type scale ([d52104d](https://github.com/guidefari/gbfm/commit/d52104d224173f5b71c3c3daa3408a57b11d24de))
* **www:** carry returnTo across auth page links and the reset email redirect ([eb0b1cb](https://github.com/guidefari/gbfm/commit/eb0b1cb4d3e74938d3c42b71e0771d21ade38cf3))
* **www:** disable the auth submit button while the form is sending ([58c50ba](https://github.com/guidefari/gbfm/commit/58c50ba406fb2201991388f78f7dd2d1b08ea19e))
* **www:** give dashboard nav items distinct names and drop duplicate comms tabs ([8cabf9a](https://github.com/guidefari/gbfm/commit/8cabf9a28d64b6fec010e653a6afc6ec06df8548))
* **www:** keep the dashboard sidebar in view and tighten its links ([d713059](https://github.com/guidefari/gbfm/commit/d7130596ca951498943c29e74b596be79d9c7785))
* **www:** keep the typed email and name after an auth error ([e4b8d62](https://github.com/guidefari/gbfm/commit/e4b8d62db4b679434f6a29e37bcfb466ed0f7219))
* **www:** return to the current page from log in links and never back into auth ([c24d278](https://github.com/guidefari/gbfm/commit/c24d278003e32cbb02469102451e7dfeb2279fcc))
* **www:** send signed-in people past the sign-in and sign-up pages ([a0583a9](https://github.com/guidefari/gbfm/commit/a0583a9c027add60ee8b2003b300c29f469808c6))
* **www:** show an expired link state instead of the reset form for bad tokens ([21f64ec](https://github.com/guidefari/gbfm/commit/21f64ecded3d325ea74889aa1d49766eadf6cd16))
* **www:** tab to forgot password after the password field ([7bf0b58](https://github.com/guidefari/gbfm/commit/7bf0b58ce9f9246ac30e03deb4feb2eb967e29bb))
* **www:** tidy dashboard settings pages and copy ([a56c1ed](https://github.com/guidefari/gbfm/commit/a56c1edebf38cdf6d355e9c8d0a41f3e287df768))
* **www:** tie auth errors to their fields and focus the field to fix ([9771129](https://github.com/guidefari/gbfm/commit/9771129bc952f3f442c1d0d3a9ea4c79fce8afd3))
* **www:** unblock dashboard search, telemetry and content paging ([27c8de0](https://github.com/guidefari/gbfm/commit/27c8de0d5c04518f370e4310a6b57ab4b3099c52))
* **www:** widen the tap area of small auth links ([f607b06](https://github.com/guidefari/gbfm/commit/f607b0653531f8d901f158044936a15b4979fc81))


### Features

* **comms:** add admin email review and subscriber tools ([e435e66](https://github.com/guidefari/gbfm/commit/e435e66618422dc01007557376f3c510d84cf89c))
* **www:** add a next-step link to auth errors people can act on ([fbf0661](https://github.com/guidefari/gbfm/commit/fbf0661c9c9a6f15d5c99672601585c262cc1d58))
* **www:** add faint wordmark backdrop to auth screens ([16e27b8](https://github.com/guidefari/gbfm/commit/16e27b8fe5885ecdc6975de766185cf35aede041))
* **www:** add shared admin list primitives ([c4ea387](https://github.com/guidefari/gbfm/commit/c4ea387c88f08269339c24654750b6e536744c9c))
* **www:** confirm a sent reset link instead of showing the form again ([029b84c](https://github.com/guidefari/gbfm/commit/029b84c68005fe174d923b1b4d607fde81dbf9ae))
* **www:** hint and enforce password length on new passwords ([d7e0a5e](https://github.com/guidefari/gbfm/commit/d7e0a5e819b64594ff06030518beac14d682745c))
* **www:** label the sign-up name field as a display name ([376c690](https://github.com/guidefari/gbfm/commit/376c690fef02f4cbbd01e5741cf0075bca77f6d1))
* **www:** let people show or hide their password on auth forms ([5470d8d](https://github.com/guidefari/gbfm/commit/5470d8d679322b22a6d6b7110213c6b966c366ef))
* **www:** list catalog entries and content as tables ([50740a2](https://github.com/guidefari/gbfm/commit/50740a2fbbb68a175d531d4b21618540070d9db5))
* **www:** open the show form on demand above a shows table ([0a6e18c](https://github.com/guidefari/gbfm/commit/0a6e18c9167132fbc450627502f6f1cf4e62076e))
* **www:** rebuild delivery history as a filterable log table ([8916f99](https://github.com/guidefari/gbfm/commit/8916f991bd5b99b9befa484ba23071c1b60841e7))
* **www:** replace the dashboard sidebar with workspace and section tabs ([5e7d6ce](https://github.com/guidefari/gbfm/commit/5e7d6ce78fee1d96170842d8751f8611f34bb17f))
* **www:** restyle auth screens with clearer hierarchy and primary action ([7253a88](https://github.com/guidefari/gbfm/commit/7253a880b5e5225f71881e6222f76cef7d09ade2))
* **www:** show auth failures inline instead of a plain-text page ([37b3f91](https://github.com/guidefari/gbfm/commit/37b3f9180b0da4aa6e9488177c25d526e8123458))
* **www:** show newsletter subscribers as a compact table ([5a59ac7](https://github.com/guidefari/gbfm/commit/5a59ac7860b4d7b3a975da43ab89daf0a8bf802c))
* **www:** show the full uncropped emblem beside the auth form ([28dab96](https://github.com/guidefari/gbfm/commit/28dab96cda4049f01dc39f1db59af9d9028357fe))
* **www:** show user sessions in a table with relative times ([06da642](https://github.com/guidefari/gbfm/commit/06da642d7be66edb17ea15d5aa460a92f2f6c09d))
* **www:** show verified and failed states on the verify-email page ([76a0b92](https://github.com/guidefari/gbfm/commit/76a0b927233fd3a0ad25aa68f7a27e4046f2a51b))
* **www:** show verify-email in the shared auth panel ([d54a631](https://github.com/guidefari/gbfm/commit/d54a63156a22b563411774d24c859f16fc85a27a))
* **www:** split playlists into a list and a detail view ([1194925](https://github.com/guidefari/gbfm/commit/1194925cdd8e3b7b72b6936e8cbe17eb93f72d8e))
* **www:** turn the admin overview into a task hub ([70a9e9a](https://github.com/guidefari/gbfm/commit/70a9e9aae470e417f18310bced6c810817d74c0b))
* **www:** turn user accounts into a dense table with row menus ([99b6474](https://github.com/guidefari/gbfm/commit/99b6474fcaa94dad8dbce6e05153837ffad6cfda))
* **www:** use shared sub-tabs for catalog and all content types ([aea21fd](https://github.com/guidefari/gbfm/commit/aea21fd8caa4391a134533ab6b1d8edd5942a736))

# [2.105.0](https://github.com/guidefari/gbfm/compare/v2.104.0...v2.105.0) (2026-10-15)


### Bug Fixes

* **seo:** expose show content and consolidate canonical URLs ([#381](https://github.com/guidefari/gbfm/issues/381)) ([e921efa](https://github.com/guidefari/gbfm/commit/e921efa56759711e0dd7583148201200a9d85067))


### Features

* **player:** repair queue creators without interrupting playback ([e4cbc12](https://github.com/guidefari/gbfm/commit/e4cbc128ccc4d29a63fe2623349a0fb41bc684eb))
* **www:** recover missing player creators on demand ([cc93481](https://github.com/guidefari/gbfm/commit/cc93481f362bfc218813041d67be961cb39d08e0))

# [2.104.0](https://github.com/guidefari/gbfm/compare/v2.103.2...v2.104.0) (2026-10-10)


### Features

* **cms:** choose the homepage featured mix ([#379](https://github.com/guidefari/gbfm/issues/379)) ([53589d3](https://github.com/guidefari/gbfm/commit/53589d33616b035f07443765156af49b4ddd58ea))

## [2.103.2](https://github.com/guidefari/gbfm/compare/v2.103.1...v2.103.2) (2026-10-08)


### Bug Fixes

* **www:** add home link to mobile navigation ([#380](https://github.com/guidefari/gbfm/issues/380)) ([a988adf](https://github.com/guidefari/gbfm/commit/a988adfc9d47bffd450026f6189860f16d547e1c))

## [2.103.1](https://github.com/guidefari/gbfm/compare/v2.103.0...v2.103.1) (2026-10-08)


### Bug Fixes

* **www:** allow origin referrers for video embeds ([#378](https://github.com/guidefari/gbfm/issues/378)) ([decf989](https://github.com/guidefari/gbfm/commit/decf9895938bdc0e4734cd74086160715de3fea5))

# [2.103.0](https://github.com/guidefari/gbfm/compare/v2.102.5...v2.103.0) (2026-10-08)


### Features

* **www:** adopt Foldkit whole-document SSR on Effect 4 ([#377](https://github.com/guidefari/gbfm/issues/377)) ([ea8cee1](https://github.com/guidefari/gbfm/commit/ea8cee1145b816806288818bcfc180d3f49cce8a))

## [2.102.5](https://github.com/guidefari/gbfm/compare/v2.102.4...v2.102.5) (2026-10-08)


### Bug Fixes

* **deploy:** require admin email for non-local deployments ([#373](https://github.com/guidefari/gbfm/issues/373)) ([a1d4a17](https://github.com/guidefari/gbfm/commit/a1d4a170929a6e461e825aca6172e0e79103d2de))
* **deploy:** validate required configuration beyond secrets ([21bf224](https://github.com/guidefari/gbfm/commit/21bf22409f2b3af62a80f3df740372771c2cffeb))

## [2.102.4](https://github.com/guidefari/gbfm/compare/v2.102.3...v2.102.4) (2026-10-08)


### Bug Fixes

* **shows:** preserve episode creators in playback responses ([#375](https://github.com/guidefari/gbfm/issues/375)) ([9a00faa](https://github.com/guidefari/gbfm/commit/9a00faa7b266994ddb824bba726cea0a6237b7ca))

## [2.102.3](https://github.com/guidefari/gbfm/compare/v2.102.2...v2.102.3) (2026-10-08)


### Bug Fixes

* **telemetry:** record HTTP failure statuses without leaking request data ([#374](https://github.com/guidefari/gbfm/issues/374)) ([0c3d66d](https://github.com/guidefari/gbfm/commit/0c3d66d10e28bc6f3b0a281c152171d25dacd59b))

## [2.102.2](https://github.com/guidefari/gbfm/compare/v2.102.1...v2.102.2) (2026-10-07)


### Bug Fixes

* **telemetry:** make failure and recovery emails actionable ([#372](https://github.com/guidefari/gbfm/issues/372)) ([ffb9317](https://github.com/guidefari/gbfm/commit/ffb9317ad07a5f0282bb289099013c2e38346bcf))

## [2.102.1](https://github.com/guidefari/gbfm/compare/v2.102.0...v2.102.1) (2026-10-07)


### Bug Fixes

* **telemetry:** correct Analytics Engine quantiles ([#371](https://github.com/guidefari/gbfm/issues/371)) ([66fbb24](https://github.com/guidefari/gbfm/commit/66fbb24308f6dca8226f5f34150081f2ea9237b8))

# [2.102.0](https://github.com/guidefari/gbfm/compare/v2.101.0...v2.102.0) (2026-10-07)


### Bug Fixes

* **api:** preserve audio pages when optional metadata fails ([c35a34e](https://github.com/guidefari/gbfm/commit/c35a34e0015b4e9a2726f358923fafbeb971919d))
* **tweets:** keep reader chrome stable while navigation metadata loads ([79260eb](https://github.com/guidefari/gbfm/commit/79260eb782dfeb856db784e9883ef79ddb420dad))
* **tweets:** size the replies placeholder from the known reply count ([071b0d4](https://github.com/guidefari/gbfm/commit/071b0d4efe16681a802affdeb2455fa3413795dd))
* **www:** highlight Tweets on tweet detail routes ([6930ef2](https://github.com/guidefari/gbfm/commit/6930ef2f6f95672d938fb6e5a118f3191fcd5394))
* **www:** replace audio detail API fan-out with one page read ([a163947](https://github.com/guidefari/gbfm/commit/a1639479384aadd38bd659b57d4e682d3195407d))
* **www:** retain empty audio description fallbacks ([6db335d](https://github.com/guidefari/gbfm/commit/6db335d9733a42d5331c2bed948c5354538b6cc2))
* **www:** stop scrollbar and tweet breadcrumb from shifting layout ([b9f343f](https://github.com/guidefari/gbfm/commit/b9f343ff497c2d66cc2b80dfeb7ce54d991d0baa))


### Features

* **api:** include parent show on audio detail ([5413c92](https://github.com/guidefari/gbfm/commit/5413c92e0b6f42305d4137c6e869b93c21971d68))
* **api:** load audio detail with one authenticated read ([1b54c6c](https://github.com/guidefari/gbfm/commit/1b54c6c908886a64ea71a1c79daae0138efee148))
* **navigation:** let readers reset their tweet reading history ([437796f](https://github.com/guidefari/gbfm/commit/437796ff3a1db936ccd10f87ee3d388754813e1b))
* **posts:** include reply count when reading a tweet by slug ([ce9855e](https://github.com/guidefari/gbfm/commit/ce9855e1eef56f166e87890d713b2326f39a9356))
* **tweets:** expose nearest newer unread neighbour ([f5da586](https://github.com/guidefari/gbfm/commit/f5da586cf3852fd920cd9e026e3d0f04bb7d248d))
* **tweets:** replace reader controls with a bottom reading dock ([4c4399a](https://github.com/guidefari/gbfm/commit/4c4399a100a9103efe622f86e30c2315683d5cf0))
* **tweets:** resume tab reading and separate unread navigation ([1d41d03](https://github.com/guidefari/gbfm/commit/1d41d0302746abe0dffb47019c1d63377bac2814))
* **www:** add a form action that resets tweet reading history ([2b1ef6d](https://github.com/guidefari/gbfm/commit/2b1ef6dc7000977adfdc977ac08d1b916396a362))
* **www:** add About page and consolidate site links ([ff0e68a](https://github.com/guidefari/gbfm/commit/ff0e68a8dc3d1a9f391d91acb77d61733e32c15e))
* **www:** add breadcrumbs to content detail pages ([0e51601](https://github.com/guidefari/gbfm/commit/0e51601afd0b45e80fe8ad3017c85cb8a520ff0b))
* **www:** add icon-only variant for public actions ([f0b6146](https://github.com/guidefari/gbfm/commit/f0b614601b1b8bf09942200f0836ed05236909de))
* **www:** redesign content detail page ([d96cb76](https://github.com/guidefari/gbfm/commit/d96cb7642fa200f82128109098c536d048829479))
* **www:** refresh home and station branding ([7e2af2c](https://github.com/guidefari/gbfm/commit/7e2af2c584449a99309646d2085f6e9a36c9c13d))
* **www:** show account avatar in station navigation ([09ee07c](https://github.com/guidefari/gbfm/commit/09ee07ca2f626763cd0eaffa09e5871502cd6eb8))
* **www:** show parent show and slug in mix breadcrumb ([6b8deb5](https://github.com/guidefari/gbfm/commit/6b8deb5ef05059e9dfadfd15edf17a95bb583d8c))


### Performance Improvements

* **audio:** load detail tags in the authorized query ([43bf9ac](https://github.com/guidefari/gbfm/commit/43bf9ac9e79b4e438ac6be8cee4af1ab502edccc))
* **auth:** resolve sessions and users in one D1 read ([0d2f0fb](https://github.com/guidefari/gbfm/commit/0d2f0fbef5ba80700f1387667ff120267f508dbd))
* **shows:** compose page data in one authorized API request ([9fbc5bc](https://github.com/guidefari/gbfm/commit/9fbc5bc476cf4d28c299d57bd5d4f2923fa03c76))
* **shows:** project labels within content queries ([b091bc6](https://github.com/guidefari/gbfm/commit/b091bc69708ecbdf7e0c4f73ede915517969f557))

# Unreleased

## Session recap: faster mix and show pages (2026-10-06)

### In brief

Reduced authenticated page-loading times while keeping real remote D1 reads. Mix pages measured **0.63–0.71 seconds**, down from **1.00–1.14 seconds**; show pages measured **0.68–0.77 seconds**, down from **1.44–1.72 seconds**. Changes are committed locally, not pushed or deployed; these are local-to-remote measurements, not production benchmarks.

### Narrative

The earlier audio-page consolidation removed duplicate requests, but signed-in pages still spent roughly a second waiting on sequential database reads. Anonymous probes did not reproduce an intermittent 9–16-second spike and later exposed transient database failures. Authenticated testing became available through secret injection with 2password.

The key correction was to stop treating “the spike did not reproduce” as a reason to stop improving normal response times. Three GPT-6.1 Sol agents worked on audio queries, show-page composition, and authentication/transport. The first integrated measurements improved mixes but left shows above a second. Traces then identified separate show-label reads as the next avoidable cost; combining those queries brought shows below 0.8 seconds in the final sample.

### Decisions and lessons

- Fetch session and user together in one D1 statement. Keep cookie caching disabled so revocation and role changes take effect on the next authenticated request.
- Fetch ordered tags within audio/show content queries instead of making separate label requests. Preserve empty-tag semantics, pagination, and draft visibility.
- Load show detail through one API request instead of six. Reuse loaded content for metadata and run episodes, navigation, and subscription reads concurrently once the show is available.
- Keep remote D1 for latency measurements and disposable D1 for correctness fixtures. Final measurements included 13 successful authenticated reads, both serial and with three concurrent callers.
- D1 uses Worker bindings, not an application-managed database connection pool. Local remote development adds a preview-worker network leg that production does not use. Fewer database round trips benefit both paths, but production gains still need measurement.

### Work and references

- Audio query projection: `apps/server/src/services/audio.service.ts` and `apps/server/src/db/entity-label-projection.ts`.
- Authentication: `apps/server/src/lib/auth.ts` and disposable-D1 coverage in `auth.d1.test.ts`.
- Show composition: `apps/server/src/services/show-page.ts`, `packages/api/src/shows.ts`, and `apps/www/src/page/shows/detail-page-data.ts`.
- Browser coverage: `apps/www/e2e/show-page.spec.ts`.
- Plan: `.specs/www-content-performance/03-read-latency-plan.md`.
- Transport findings: `.specs/www-content-performance/04-session-transport-findings.md`.
- Measurements, trace IDs, and verification details: `.specs/www-content-performance/05-read-latency-results.md`.

### Commands and verification

- `bun precommit`: passed after integration and after the final label-query changes.
- `bun run test` in `apps/server`: 647 tests passed before the final label follow-up; that follow-up passed 67 targeted tests across eight suites.
- `bun run unit` in `apps/www`: 132 tests passed. API tests: 30 passed.
- `bun run build` in `apps/www`: passed; the existing large-client-chunk warning remains.
- Audio/show Playwright coverage initially passed all 16 Mobile Safari/Chrome cases. After the final query changes, 15 passed and one Safari navigation case was blocked by a Vite/Foldkit request-body error overlay. Both navigation cases passed in isolation; the parallel run is not claimed fully green.

### Commits

- `dba98f42`: plan parallel read-latency improvements.
- `43bf9ac9`: load audio detail tags in the authorized query.
- `0d2f0fbe`: resolve sessions and users in one D1 read.
- `9fbc5bc4`: compose show pages in one API request.
- `fd6b92d1`: cover composed show pages in mobile browsers.
- `b091bc69`: project show and episode labels within content queries.
- `37252c13`: record remote latency gains and validation.

### Open threads

- The remaining critical path is approximately three sequential remote waits. Investigate further overlap or deployment placement with measurements rather than adding speculative caching or retries.
- The earlier intermittent latency spike and database failures remain unexplained, not fixed by assertion.
- Investigate the Vite/Foldkit “Response body object should not be disturbed or locked” error seen during parallel browser testing.
- Smart Placement and selective replica reads remain proposals. Neither was applied; authentication consistency must be preserved.

# [2.101.0](https://github.com/guidefari/gbfm/compare/v2.100.3...v2.101.0) (2026-10-03)


### Features

* **www:** introduce Foldkit SSR replacement (parity in progress) ([#356](https://github.com/guidefari/gbfm/issues/356)) ([24e19c1](https://github.com/guidefari/gbfm/commit/24e19c1a7bdbd40c813324cb2e86a2a5fd65095f)), closes [#365](https://github.com/guidefari/gbfm/issues/365)

## [2.100.3](https://github.com/guidefari/gbfm/compare/v2.100.2...v2.100.3) (2026-09-27)


### Bug Fixes

* **db:** use flat D1 migration layout ([#355](https://github.com/guidefari/gbfm/issues/355)) ([b926872](https://github.com/guidefari/gbfm/commit/b9268723d359247744f388c58f9004a928c68ac5))

## [2.100.2](https://github.com/guidefari/gbfm/compare/v2.100.1...v2.100.2) (2026-09-26)


### Bug Fixes

* **alchemy:** apply D1 migrations on deploy ([#354](https://github.com/guidefari/gbfm/issues/354)) ([d8bffbd](https://github.com/guidefari/gbfm/commit/d8bffbd7de14469f57364a417f2870b4514c3022))

## [2.100.1](https://github.com/guidefari/gbfm/compare/v2.100.0...v2.100.1) (2026-09-26)


### Bug Fixes

* **db:** canonicalize legacy audio URLs ([#353](https://github.com/guidefari/gbfm/issues/353)) ([3c0947e](https://github.com/guidefari/gbfm/commit/3c0947e9cc2bb52af238e2baf4ce63577e272dfd))

# [2.100.0](https://github.com/guidefari/gbfm/compare/v2.99.0...v2.100.0) (2026-09-24)


### Bug Fixes

* **www:** align composer widths and surface editorial artwork ([61bf5a9](https://github.com/guidefari/gbfm/commit/61bf5a95e62d841d332adacdb298bb4c275b976d))


### Features

* **www:** add # tag autocomplete to the markdown editor ([7d8b692](https://github.com/guidefari/gbfm/commit/7d8b69260daaaf767d673784147913492045c3dd)), closes [#fragment](https://github.com/guidefari/gbfm/issues/fragment)
* **www:** hide editor view-mode toggle in the composer ([4923b7c](https://github.com/guidefari/gbfm/commit/4923b7ccc733faf9df0b798e6a4916766f4b4571))
* **www:** two-step composer with autosave drafts and a publish modal ([7edc96f](https://github.com/guidefari/gbfm/commit/7edc96f45ca63704606ae8fa1cc99e4e237272d2))

# [2.99.0](https://github.com/guidefari/gbfm/compare/v2.98.1...v2.99.0) (2026-09-24)


### Bug Fixes

* **editorial:** stop hashtag stripping from corrupting markdown and word-joined text ([91f1ac8](https://github.com/guidefari/gbfm/commit/91f1ac80d4ab1c427fdbc2f735500172534856ec))


### Features

* **www:** unify tweet and editorial into one /new composer ([89e1475](https://github.com/guidefari/gbfm/commit/89e147558d4cadc9701d4b688ccd81d44a04e70f))

## [2.98.1](https://github.com/guidefari/gbfm/compare/v2.98.0...v2.98.1) (2026-09-24)


### Bug Fixes

* **music:** make playlist enrichment durable ([#346](https://github.com/guidefari/gbfm/issues/346)) ([3e5eae8](https://github.com/guidefari/gbfm/commit/3e5eae856d927d02d1cb1334362a95124f99b81f)), closes [#342](https://github.com/guidefari/gbfm/issues/342)

# [2.98.0](https://github.com/guidefari/gbfm/compare/v2.97.1...v2.98.0) (2026-09-24)


### Features

* tweet dx ([0e65f77](https://github.com/guidefari/gbfm/commit/0e65f7704dcc969511bb1be1b21a779ffae8ddab))
* **www:** redesign tweet capture around the resolve-first flow ([0da7c1a](https://github.com/guidefari/gbfm/commit/0da7c1a9e0399e22f6611823a7f8e7ea9b0728ee))

## [2.97.1](https://github.com/guidefari/gbfm/compare/v2.97.0...v2.97.1) (2026-09-23)


### Bug Fixes

* **editor:** stop pointing TypeScript SDK at tsgo ([5769b15](https://github.com/guidefari/gbfm/commit/5769b154bef80f852c897cd04f83393ac9b6d377))

# [2.97.0](https://github.com/guidefari/gbfm/compare/v2.96.1...v2.97.0) (2026-09-19)


### Features

* **seo:** add site-wide social cards ([#338](https://github.com/guidefari/gbfm/issues/338)) ([df77572](https://github.com/guidefari/gbfm/commit/df7757277e51a22543cd46d6728f1f732802af14))

## [2.96.1](https://github.com/guidefari/gbfm/compare/v2.96.0...v2.96.1) (2026-09-18)


### Bug Fixes

* **social:** render generated images in workerd ([#336](https://github.com/guidefari/gbfm/issues/336)) ([7087dc8](https://github.com/guidefari/gbfm/commit/7087dc8588f6ab279568aa1a3ab3acb6f9f63889))

# [2.96.0](https://github.com/guidefari/gbfm/compare/v2.95.0...v2.96.0) (2026-09-17)


### Features

* unify site-wide metadata ([#330](https://github.com/guidefari/gbfm/issues/330)) ([0d4f001](https://github.com/guidefari/gbfm/commit/0d4f001605337b1613c0d1b54d6b9090d31e2529))

# [2.95.0](https://github.com/guidefari/gbfm/compare/v2.94.0...v2.95.0) (2026-09-13)


### Features

* **social:** unify generated tweet share images ([#328](https://github.com/guidefari/gbfm/issues/328)) ([76df302](https://github.com/guidefari/gbfm/commit/76df3027e9a3fb692f369bfbd5c01e3a43fc4f25))

# [2.94.0](https://github.com/guidefari/gbfm/compare/v2.93.1...v2.94.0) (2026-09-13)


### Features

* **www:** render tweet metadata at the edge ([#327](https://github.com/guidefari/gbfm/issues/327)) ([88b081a](https://github.com/guidefari/gbfm/commit/88b081a195d434f4b0d4f21989c64270b2c1c3cb))

## [2.93.1](https://github.com/guidefari/gbfm/compare/v2.93.0...v2.93.1) (2026-09-06)


### Bug Fixes

* **music:** fail fast on unknown entity types ([d2eb19e](https://github.com/guidefari/gbfm/commit/d2eb19eaa3335cfd7a71ed588b294e780d0c2be7))

# [2.93.0](https://github.com/guidefari/gbfm/compare/v2.92.0...v2.93.0) (2026-09-05)


### Bug Fixes

* **editorial:** keep embed pickers inside the workspace dialog ([16902fc](https://github.com/guidefari/gbfm/commit/16902fc30c7d49d645288d074fb1fc7e0487dd62))
* gap on editor toolbar ([44b725c](https://github.com/guidefari/gbfm/commit/44b725c0ffaccf962ce79aa9d7fb9d1da276e76b))
* **spotify:** load every album and playlist track page ([0cd2065](https://github.com/guidefari/gbfm/commit/0cd2065e17e08165b185858d138d559092789ab4))


### Features

* **music:** share track lists and listening controls across embeds ([c7e3518](https://github.com/guidefari/gbfm/commit/c7e35181625f7af0e48a1ed2ba39051a61d66d67))

# [2.92.0](https://github.com/guidefari/gbfm/compare/v2.91.0...v2.92.0) (2026-09-05)


### Bug Fixes

* **music:** derive link identity from parsed source ([6c16d67](https://github.com/guidefari/gbfm/commit/6c16d67b9d62f432ba32b7c465ceb31658a64c1d))
* **music:** enforce parser-supported link identity ([1128cad](https://github.com/guidefari/gbfm/commit/1128caddc46bf5de7c971227b3ce67daa47395c5))
* **music:** keep playlist link sync best effort ([006c0db](https://github.com/guidefari/gbfm/commit/006c0dbd5390d120ae74aed5f04745956fdc7ea4))
* **music:** make identity refresh deterministic ([f3340ea](https://github.com/guidefari/gbfm/commit/f3340eaea7580fc9e3eca2052df30f286be4f6b3))
* **music:** preserve canonical metadata on verification ([f6d280a](https://github.com/guidefari/gbfm/commit/f6d280a836ad75aa1a935bde4b535b11a544f73f))
* **music:** preserve legacy link workflows ([bca5e22](https://github.com/guidefari/gbfm/commit/bca5e2281c93a6bb59abc8af9986775642925a04))
* **music:** return copied artist artwork URL ([1126eab](https://github.com/guidefari/gbfm/commit/1126eabb2d4b0ff8aa1274b16df98d069eafb536))
* **music:** sanitize playlist enrichment failures ([47085c8](https://github.com/guidefari/gbfm/commit/47085c82bd5a625397e74970de8527f67b9ad2f7))
* **server:** restore atomic remote D1 batches ([80bd26d](https://github.com/guidefari/gbfm/commit/80bd26d02b9b106d326cce52e97294b3c681766d))
* **server:** restore valid remote D1 queries ([310f453](https://github.com/guidefari/gbfm/commit/310f4538c2fdae1a0cd6236ad40c8893ff5f6c0f))


### Features

* **editorial:** share music resolution cache ([bdd895f](https://github.com/guidefari/gbfm/commit/bdd895ffa21869a81406a15b0a79809d3419525b))
* **music:** add canonical source identity schema ([0cf831f](https://github.com/guidefari/gbfm/commit/0cf831f21430ffd5694b1979f1fa4cdad80bb4b7))
* **music:** add identity maintenance tooling ([7089351](https://github.com/guidefari/gbfm/commit/7089351b23568f32b48f0706cc022be6d4a081c7))
* **music:** add identity rollout telemetry ([6981bf5](https://github.com/guidefari/gbfm/commit/6981bf5725cec7d166e4c294548ac8cceb112126))
* **music:** resolve canonical source identities ([b0126d8](https://github.com/guidefari/gbfm/commit/b0126d8b838d9dfba3334a3abb645b61db065a7f))
* **music:** route callers through canonical identity ([7264dc1](https://github.com/guidefari/gbfm/commit/7264dc131e6c979a77d11fbc0d25134015ed5b64))

# [2.91.0](https://github.com/guidefari/gbfm/compare/v2.90.0...v2.91.0) (2026-09-03)


### Bug Fixes

* **dev:** pin local worker ports ([f53bb1c](https://github.com/guidefari/gbfm/commit/f53bb1c8aead0326e0c7538e1c1131b6f349c589))
* **editorial:** clarify description field ([6869700](https://github.com/guidefari/gbfm/commit/68697003ba40cf6e7e43c1b9aa1db306dc25d4f0))
* **editorial:** consolidate writing controls ([06c508f](https://github.com/guidefari/gbfm/commit/06c508f4f49ddb0726b8fc5c05585380dbe4e026))
* **editorial:** place linked music after prose ([2fe1f1c](https://github.com/guidefari/gbfm/commit/2fe1f1c65bdda4a8a95addd668665e12892457a1))
* **editorial:** refine the writing workspace ([eef49f2](https://github.com/guidefari/gbfm/commit/eef49f29f36cfe1e0e1c9fd2d74e567fcc7b7acb))


### Features

* **editorial:** add safe external media embeds ([ba37b3c](https://github.com/guidefari/gbfm/commit/ba37b3c4080ae575546d6f366c23deeb92bb2aef))
* **editorial:** create immersive writing workspace ([56739ea](https://github.com/guidefari/gbfm/commit/56739eab521420ef97f3035633dd0927668cc063))
* **editorial:** embed pasted Spotify links ([82ce028](https://github.com/guidefari/gbfm/commit/82ce028e35f01f1226a7c9bb6dbc2360ad081eb6))
* **editorial:** resolve pasted music entities ([dd2d6db](https://github.com/guidefari/gbfm/commit/dd2d6db4419e30677359cf5a09674ab806813433))
* **editorial:** share reusable post tags ([785dc3f](https://github.com/guidefari/gbfm/commit/785dc3fcda379c04768ad2e27a5d7ad693fbfa4e))
* **pdf:** isolate QR generation worker ([8b8e1fb](https://github.com/guidefari/gbfm/commit/8b8e1fbdfc823892c4b031faab593e5c683c8839))
* replace legacy markdown editor ([661da0f](https://github.com/guidefari/gbfm/commit/661da0f48b5c2007a30140332b4a9c65e135b1cb))
* **tags:** unify post tag discovery ([e4862cd](https://github.com/guidefari/gbfm/commit/e4862cd70c9fc7df6274dca80221f826e5c1046b))
* **www:** add editorial music entity embeds ([256e02a](https://github.com/guidefari/gbfm/commit/256e02a4190bd5eafc0532f7997467590e7cf9a6))
* **www:** redesign editorial workspace ([bcce7be](https://github.com/guidefari/gbfm/commit/bcce7be9e3fd3ff2ce04fef3580324c0e87437a0))

# [2.90.0](https://github.com/guidefari/gbfm/compare/v2.89.1...v2.90.0) (2026-09-02)


### Features

* **cdn:** serve responsive image variants ([665fef1](https://github.com/guidefari/gbfm/commit/665fef12be24751b385062a9928aba4141577de5))


### Performance Improvements

* **www:** request responsive artwork ([25bdd99](https://github.com/guidefari/gbfm/commit/25bdd99d9b0f4e4a5250c3c5a52a70a47d6d9b5c))

## [2.89.1](https://github.com/guidefari/gbfm/compare/v2.89.0...v2.89.1) (2026-09-02)


### Bug Fixes

* **www:** recover failed featured artwork ([52b3f42](https://github.com/guidefari/gbfm/commit/52b3f42c2fcb3d2fcdd20d8d22b45df09041fd7e))
* **www:** stabilize the public first load ([68d336d](https://github.com/guidefari/gbfm/commit/68d336d691cad29157d790ef67a793b4a6cf72a8))

# [2.89.0](https://github.com/guidefari/gbfm/compare/v2.88.1...v2.89.0) (2026-08-31)


### Bug Fixes

* **db:** make the 0054 postgres migration valid postgres ([bcd42b0](https://github.com/guidefari/gbfm/commit/bcd42b00e72a389ba2e3847ae5aeae825c117942))
* **server:** annotate the request span callback return type ([f7230f8](https://github.com/guidefari/gbfm/commit/f7230f8ebf00d4cc6500c98e352c4df2335be475))
* **server:** populate replyCount on micro post listings ([35fc367](https://github.com/guidefari/gbfm/commit/35fc36706dffeb4185be1b98eea027cf09aaa14f))
* **server:** stop publishing a localhost sitemap ([503d02f](https://github.com/guidefari/gbfm/commit/503d02fb424fa6cd9ba005c752969fd90f7d6e96))
* **server:** use bare crypto global so typecheck passes on clean installs ([056d0f3](https://github.com/guidefari/gbfm/commit/056d0f3df4bd120ac4224146a05a5fb3936a03ca))
* **www:** show reply context in tweet search results ([6f1848d](https://github.com/guidefari/gbfm/commit/6f1848d24c1eb6671deb10fd155864f30fc52d63))
* **www:** stop tweet nav blocking on background work ([918eb03](https://github.com/guidefari/gbfm/commit/918eb031ba911beb893ceb38be169a61c1dc7ac8))


### Features

* **www:** add navigation head model and local tweet trail ([db683b1](https://github.com/guidefari/gbfm/commit/db683b198db9c362e3bf7aacb8e4180b7fe3524e))
* **www:** show reply counts in tweet search results ([8dc181a](https://github.com/guidefari/gbfm/commit/8dc181a4673601558e4c1e18ea7fc52cfc4dfe23))


### Performance Improvements

* **db:** index navigation lookups for the anti-join ([bb5cd14](https://github.com/guidefari/gbfm/commit/bb5cd14ea76b3eb0e29fa2019f515824279a9b01))
* **server:** cut navigation round trips from six to one ([2315d59](https://github.com/guidefari/gbfm/commit/2315d591efe3e4e1d1c9003523be87f478a14801))

## [2.88.1](https://github.com/guidefari/gbfm/compare/v2.88.0...v2.88.1) (2026-08-30)


### Bug Fixes

* tweet share card ([476209b](https://github.com/guidefari/gbfm/commit/476209b57cd2f8e1f589609334519dcbc7644650))

# [2.88.0](https://github.com/guidefari/gbfm/compare/v2.87.0...v2.88.0) (2026-08-27)


### Bug Fixes

* **effect:** remove broad error channels ([ae3561a](https://github.com/guidefari/gbfm/commit/ae3561a074890bd27666329632a92bafab1c4576))


### Features

* **dev:** serve web app through Portless ([ecc0dcb](https://github.com/guidefari/gbfm/commit/ecc0dcbe9bd88cd73f7e0a369bcab1cc96aa6076))
* **observability:** export Worker telemetry ([1942762](https://github.com/guidefari/gbfm/commit/1942762672f66e5eda2095279ac3e936ccfcb2fb))

# [2.87.0](https://github.com/guidefari/gbfm/compare/v2.86.1...v2.87.0) (2026-08-23)


### Bug Fixes

* **config:** point non-prod stages at their own CDN router ([946066e](https://github.com/guidefari/gbfm/commit/946066e8d0934602647381a2dfeb126e6a04b768))
* **deps:** patch cloudflare-runtime's undefined asset-config logger ([7390d32](https://github.com/guidefari/gbfm/commit/7390d323df31580805fbfaf48d71b15dd1f2dab8))
* **dev:** bind local API to production D1 ([fa3c9f4](https://github.com/guidefari/gbfm/commit/fa3c9f4ca524e53df95de74155ee989da2f7bb3c))
* **dev:** run www on Vite port ([392519d](https://github.com/guidefari/gbfm/commit/392519d83270771a344f24a599d937f2238231b4))
* **effect:** add monotonic members to Clock test doubles ([c02a8ff](https://github.com/guidefari/gbfm/commit/c02a8ff2973b636e18c998762209923bafacf29f))
* **effect:** rename Schema.TaggedErrorClass to Schema.TaggedError ([d886ff5](https://github.com/guidefari/gbfm/commit/d886ff52b32fda44ffab4afcc75682e0bc10f411))
* **infra:** adapt to alchemy beta.72 Worker API and pin a supported compat date ([fb9a68f](https://github.com/guidefari/gbfm/commit/fb9a68f169f3011e321b0121e3cbc7d64373630b))
* **music:** enforce resolver identity invariants ([67f12b3](https://github.com/guidefari/gbfm/commit/67f12b3e568f2e469749308bd8e76f194091274c))
* **music:** preserve provider outcome semantics ([bdf924e](https://github.com/guidefari/gbfm/commit/bdf924e89893a0bf9c6d88ae336176c1b6e544f2))
* **music:** stop hiding cover upload failures on resolve ([ef43f4d](https://github.com/guidefari/gbfm/commit/ef43f4dffb828854f630a6e004e01d697f638fbb))


### Features

* **infra:** bind dev secrets as secret_text instead of the Secrets Store ([1042170](https://github.com/guidefari/gbfm/commit/10421708a0e7eb8096b696b03d25e29f7f896b02))
* **music:** archive provider artwork ([017f662](https://github.com/guidefari/gbfm/commit/017f66246c4d8aae38584839dba3fcd7ea5ef968))
* **music:** resolve entities across trusted sources ([2d5948b](https://github.com/guidefari/gbfm/commit/2d5948bf2fd0a8cb070b4aaa5bdf0d678cdf0824))

## [2.86.1](https://github.com/guidefari/gbfm/compare/v2.86.0...v2.86.1) (2026-08-14)


### Bug Fixes

* **mobile:** satisfy type-aware linting ([ef80286](https://github.com/guidefari/gbfm/commit/ef802868f8dc9c1fa7475050fa15336e4b62c42f))
* **packages:** satisfy type-aware linting ([39f9c45](https://github.com/guidefari/gbfm/commit/39f9c45ab99ba12e89e1f30469c771389cb8a1ef))
* **server:** satisfy type-aware linting ([a122627](https://github.com/guidefari/gbfm/commit/a122627f93c854a501efe5a75125ae5d3130ccea))
* **tooling:** declare Worker types for root checks ([b1a83db](https://github.com/guidefari/gbfm/commit/b1a83dbbc17e2519c3c7ac86e124d5079c4c1a5b))
* **www:** satisfy type-aware linting ([2d52f6b](https://github.com/guidefari/gbfm/commit/2d52f6b5e50fe37b30570ed9c83e2b3e06a63e5b))

# [2.86.0](https://github.com/guidefari/gbfm/compare/v2.85.0...v2.86.0) (2026-08-14)


### Bug Fixes

* add actor to request ([1e35a52](https://github.com/guidefari/gbfm/commit/1e35a52fbd9f8ced15f28024b27b960652a2b3cd))
* **infra:** restore R2 bucket CORS and port the QR PDF expiry sweep ([dca249e](https://github.com/guidefari/gbfm/commit/dca249e04c3ac6e74653352f4452199e1cc72875))
* **music:** expose resolution unavailability ([8a8cf01](https://github.com/guidefari/gbfm/commit/8a8cf01d09c14a287d5b5899f21e235d17bcb4bf))
* **music:** identify goosebumps.fm to MusicBrainz ([00ada0b](https://github.com/guidefari/gbfm/commit/00ada0b6979883cfdfd280484ad5b2eba7b1cbca))
* **music:** make URL resolution idempotent ([58d730f](https://github.com/guidefari/gbfm/commit/58d730f92d46e8d5564f0b9e05c1c294ea38573c))
* **music:** map resolution contention ([e6effb0](https://github.com/guidefari/gbfm/commit/e6effb097567c0da8b02002733eeb9ad1169492a))
* **music:** recover stale resolution claims ([7dac630](https://github.com/guidefari/gbfm/commit/7dac630173a0452b8c1cdfd97bd5af568a337d12))
* **music:** return bad request for unresolved links ([1ee388c](https://github.com/guidefari/gbfm/commit/1ee388c6e07073d85d3cc32c73d1667086f8485c))
* **server:** harden music resolution persistence ([936308b](https://github.com/guidefari/gbfm/commit/936308b51bd9335c837dc5e9454fdaef2d831cf6))
* **server:** harden music URL resolution ([5e78fd5](https://github.com/guidefari/gbfm/commit/5e78fd5116dde05455d308fa5608f337768426c1))
* **www:** add music resolution retry UX ([7281839](https://github.com/guidefari/gbfm/commit/72818395268372770ff3e208d3e538b5563ae70e))


### Features

* **music:** add admin link rescrape ([2e8926a](https://github.com/guidefari/gbfm/commit/2e8926a053fcd56a8be1922c89e59d5f77d545b0))
* **server:** rescrape Odesli entity links ([d68f150](https://github.com/guidefari/gbfm/commit/d68f1509a76209ad511fee5f402e260519616729))

# [2.85.0](https://github.com/guidefari/gbfm/compare/v2.84.1...v2.85.0) (2026-08-13)


### Bug Fixes

* **dev:** proxy www dev server to the D1 worker without going cross-site ([830ae1c](https://github.com/guidefari/gbfm/commit/830ae1c62793cc092f63163408e27b6f102c3abc))
* make ox tooling production-ready ([c3b14e6](https://github.com/guidefari/gbfm/commit/c3b14e6fa5443f07f87c43e7ebd38f869d819bc2))
* **migrate:** baseline the migration ledger from Cloudflare's d1_migrations ([950e875](https://github.com/guidefari/gbfm/commit/950e875822c11fdccd7f106f30d4b8ec26c7e5f5))
* **mobile:** satisfy anti-slop lint rules ([3ff99fe](https://github.com/guidefari/gbfm/commit/3ff99fe18de2b231bfb790424c5133c4aee099dd))
* **navigation:** persist replayed cursor moves ([b693976](https://github.com/guidefari/gbfm/commit/b693976bf5fe85051287fe143bb1ea5d4cdd9773))
* restore anti-slop enforcement ([bcccd7c](https://github.com/guidefari/gbfm/commit/bcccd7c3b48b9f7ceb4eec5215e14712b9febb7d))
* satisfy anti-slop lint in libraries ([617d810](https://github.com/guidefari/gbfm/commit/617d810dcb5eef1239bbe80f05d47548ce214d7e))
* **server:** add deterministic secondary sort key to music-entity list queries (OPS-249) ([de79e3d](https://github.com/guidefari/gbfm/commit/de79e3d14c4d09a4d7152e6c6171267eaf6aee13))
* **server:** add missing 0000 baseline to Postgres migration chain (OPS-252) ([321a5c7](https://github.com/guidefari/gbfm/commit/321a5c70d80f7dee78c4053a8797285b50139624))
* **server:** allow blank aws storage credentials in production validation (OPS-244) ([5563d02](https://github.com/guidefari/gbfm/commit/5563d026be1c20fe0035e2d9a00a0b984a408077))
* **server:** bind Worker secrets for OPS-244 ([7214b0c](https://github.com/guidefari/gbfm/commit/7214b0ccab58721925e4331046c63bac6f84076a))
* **server:** boot D1 staging worker (OPS-249) ([986813f](https://github.com/guidefari/gbfm/commit/986813f07e1995d39191e91a172fcb228e21436e))
* **server:** defer MDX compiler evaluation (OPS-257) ([754779a](https://github.com/guidefari/gbfm/commit/754779ae1aef3e6b5f0cb45bbfc72f16c3e2cda7))
* **server:** guard favorite writes against D1 concurrent-insert races (OPS-258) ([36ac95c](https://github.com/guidefari/gbfm/commit/36ac95cc62b96cb7d4ea89b6f6fd22cb0344e027))
* **server:** harden D1 production migration (OPS-249) ([840db8f](https://github.com/guidefari/gbfm/commit/840db8f677df621a5c0bb6a779260ed24ff4c9df))
* **server:** parse Postgres naive timestamps as UTC in the D1 migration script (OPS-249) ([52a0a1c](https://github.com/guidefari/gbfm/commit/52a0a1c1c25bf7eab4ee61d0383c30d9d5c4a3b0))
* **server:** repair 0013 migration so it replays on a fresh chain (OPS-252) ([a7c0b77](https://github.com/guidefari/gbfm/commit/a7c0b774e50a13f4c7dafa1240b0ac30db1dec7d))
* **server:** return null, not [], for entities with no tags or genres (OPS-249) ([0625214](https://github.com/guidefari/gbfm/commit/0625214f1c3eb937ed7eb30fff2de6920413ec83))
* **server:** satisfy anti-slop lint rules ([1ddef6e](https://github.com/guidefari/gbfm/commit/1ddef6e6f442864eb7c6ce190b25afa9219dd88b))
* **server:** serialize Spotify imports (OPS-259) ([e2e4682](https://github.com/guidefari/gbfm/commit/e2e4682be8db1ed5e9440c7c9788d61362d5030b))
* **server:** trust the gbfm.localhost dev origin (OPS-244) ([b74aaed](https://github.com/guidefari/gbfm/commit/b74aaeda9068010dc6f885db4b0aec3f63f2c66b))
* **tweets:** distinguish route loading from navigation sync ([c11c0e6](https://github.com/guidefari/gbfm/commit/c11c0e60cc480e0d7065510d87b3d27f6f861f57))
* **tweets:** eliminate cold-render layout shifts ([a363a02](https://github.com/guidefari/gbfm/commit/a363a028af9a94c7b3436c0c67954296a5b94636))
* **tweets:** keep navigation status out of document flow ([d3be9a1](https://github.com/guidefari/gbfm/commit/d3be9a1303d3527fd1346b5497320b14c235e491))
* **tweets:** navigate without blocking on neighbor preloads ([2976942](https://github.com/guidefari/gbfm/commit/2976942b168bb9a0a1bcc775ec076b6aa8463019))
* **vps:** point unit test harness at Miniflare D1 instead of pg Pool ([0c32492](https://github.com/guidefari/gbfm/commit/0c3249243c5cb114fe053ef28b6ab5ca07bcd538))
* **vps:** stop timeQuery from resolving Database via the module singleton (OPS-254) ([e334d2f](https://github.com/guidefari/gbfm/commit/e334d2f091a772f8949e38009367ebaadda4c61a))
* **vps:** use Cloudflare Sentry in worker (OPS-248) ([905e048](https://github.com/guidefari/gbfm/commit/905e048097eb3fb201640ee901374b5ae68dec15))
* **vps:** use SQLite-compatible like() in relational-queries smoke test ([f6452ea](https://github.com/guidefari/gbfm/commit/f6452eadc9842f8fffaecd254b91df5ac5729dfa))
* **worker:** bind the R2 signing account (OPS-244) ([f7ed96c](https://github.com/guidefari/gbfm/commit/f7ed96c4d837e2c2d66694ed9054f256aae3e81a))
* **worker:** split scheduled jobs by cron (OPS-244) ([09a12f3](https://github.com/guidefari/gbfm/commit/09a12f31067a453041b9c2c6e1dd3a22d34f4170))
* **worker:** use native R2 storage (OPS-244) ([563af34](https://github.com/guidefari/gbfm/commit/563af3479f0d7dd9519a9821bc7fbbc38b4fb902))
* **www:** satisfy anti-slop lint rules ([57ae96c](https://github.com/guidefari/gbfm/commit/57ae96cc83b6049706a478442e65f1c530d38b91))


### Features

* **cdn:** port the CDN router to Alchemy on the prod R2 buckets ([5b82877](https://github.com/guidefari/gbfm/commit/5b82877731079276b8f106c4d900f8753b67f65f))
* **cdn:** serve cdn.goosebumps.fm from the Alchemy CDN router ([50488cc](https://github.com/guidefari/gbfm/commit/50488ccb3f1c5b8c311763bc688a57c716d0bc15))
* **db:** add database context layer (OPS-246) ([74986ff](https://github.com/guidefari/gbfm/commit/74986ff09216b813ebad50f2a4a9fb59a86c5883))
* **db:** translate schemas to D1 (OPS-247) ([0b375bf](https://github.com/guidefari/gbfm/commit/0b375bf831f615d012997129f9a569d6de33e425))
* **dev:** start Alchemy with SST ([2fe82c4](https://github.com/guidefari/gbfm/commit/2fe82c4da67cd1ca05c2db7f3003d2a471214979))
* **email:** replace SES with Cloudflare sending ([fded1ba](https://github.com/guidefari/gbfm/commit/fded1baa650c255ece3d0de773a959ffd5f8cae8))
* **infra:** add Alchemy V2 stack for Cloudflare Workers migration ([6fc3c90](https://github.com/guidefari/gbfm/commit/6fc3c904ae6bc03ae3cadf5aff36fd8509b8df1f))
* **infra:** declare Worker secrets in the Cloudflare Secrets Store ([cdec70a](https://github.com/guidefari/gbfm/commit/cdec70acd023b3c02045358b322b4be4765a6dab))
* **infra:** port www, redirects and auth URL into Alchemy ([665b837](https://github.com/guidefari/gbfm/commit/665b8375e2bc653ebcd08c86cf11274860d9727a))
* **infra:** serve goosebumps.fm from the Alchemy site worker ([d4b0545](https://github.com/guidefari/gbfm/commit/d4b0545efca87e8b25e553fbd376afb3e730c948))
* **migration:** target deployed D1 from the pg import ([b1e114c](https://github.com/guidefari/gbfm/commit/b1e114c1e144912656d990c639272573a1b629d8))
* **navigation:** expose effective forward destination ([0495d25](https://github.com/guidefari/gbfm/commit/0495d2537d9f1a4991f4b08ae00c3ba6fbc728e4))
* **navigation:** show pending route feedback ([1d96140](https://github.com/guidefari/gbfm/commit/1d961401fe93edc9cc80424918807ad7a428c072))
* **server:** add Postgres to D1 data migration tooling (OPS-249) ([0dcac42](https://github.com/guidefari/gbfm/commit/0dcac42beecadc727c4a2f6d60c78a026d4014a9))
* **server:** read secrets from the Cloudflare Secrets Store ([7ba398a](https://github.com/guidefari/gbfm/commit/7ba398ae14c5c5dae25f6270a421984a8b68b5bb))
* **server:** run the Bluesky sync and retention sweep on a Worker cron ([b70fefb](https://github.com/guidefari/gbfm/commit/b70fefb2ddbfaff242fd5901706ecf12323ea265))
* **vps:** add ReminderQueue capability and idempotent claim (OPS-248) ([63fdbb1](https://github.com/guidefari/gbfm/commit/63fdbb1fe5494ac549bfe2200df3256928ae7903))
* **vps:** add SitemapCache KV-backed capability (OPS-248) ([4421c7c](https://github.com/guidefari/gbfm/commit/4421c7c02f8b86b04c068b28e9bc10786d20c003))
* **vps:** add worker.ts composition seam; delete Bun loops/shutdown (OPS-248) ([b566c63](https://github.com/guidefari/gbfm/commit/b566c6333ee286a376b7fd33cb046c4432f8ce0a))
* **vps:** replace bluesky sync SSE route with polled status endpoint (OPS-248) ([683cbc8](https://github.com/guidefari/gbfm/commit/683cbc80f104a7dd3700c8442e55d53ed64d456b))
* **vps:** replace navigation FOR UPDATE lock with a Durable Object (OPS-248) ([036d988](https://github.com/guidefari/gbfm/commit/036d988baf15e60a8f3945ac52b2582559275935))


### Performance Improvements

* **navigation:** batch result snapshot reads ([55f90d0](https://github.com/guidefari/gbfm/commit/55f90d01679997c6912afd044d07eeb2ee72dc36))
* **navigation:** batch session snapshot reads ([31b1003](https://github.com/guidefari/gbfm/commit/31b10031fe00f4046e4141bbe978e65246fb1bd6))
* **navigation:** collapse destination and write round trips ([01e8dd1](https://github.com/guidefari/gbfm/commit/01e8dd16d78641c669898afaf9419e3a3720fc0a))
* **navigation:** execute replay reads concurrently ([e141a43](https://github.com/guidefari/gbfm/commit/e141a4372b96aa1e2168a0ba286bc870380b0f2c))
* **navigation:** resolve destinations with post references ([c2a41a7](https://github.com/guidefari/gbfm/commit/c2a41a746e108d6d1b002470392d8f0436e93d0e))
* **navigation:** run independent reads concurrently ([c5a133c](https://github.com/guidefari/gbfm/commit/c5a133c1fcad9a7ff055dfea11a92450df24d14d))
* **posts:** assemble rich posts concurrently ([8e7dae4](https://github.com/guidefari/gbfm/commit/8e7dae4013a9203a1c38e2985c586fc759a7a4b0))
* **tweets:** batch reply list reads ([c6eef1d](https://github.com/guidefari/gbfm/commit/c6eef1deb00a801a1a425d803ed37fdf6d432912))
* **tweets:** batch rich post reads ([d98d05c](https://github.com/guidefari/gbfm/commit/d98d05c4c9ca42e39ec7e5bfd4fb036202994c41))
* **tweets:** load post and navigation state concurrently ([2cd2633](https://github.com/guidefari/gbfm/commit/2cd263353b2e24ada9ce5537425a3b12e0e56a89))
* **tweets:** preload and optimistically open neighbours ([e01ea40](https://github.com/guidefari/gbfm/commit/e01ea40e504b574fdc0de0ef6bd5cde568b52aba))
* **tweets:** preload layout-affecting dependencies ([9f76fa7](https://github.com/guidefari/gbfm/commit/9f76fa7a34a35bda77eae459647fd9dfa4893d39))
* **tweets:** remove redundant rich post reads ([07dedb5](https://github.com/guidefari/gbfm/commit/07dedb5fd6c2d4c84214bd38ac8d9089e213e76b))

## [2.84.1](https://github.com/guidefari/gbfm/compare/v2.84.0...v2.84.1) (2026-08-08)


### Bug Fixes

* **ci:** bridge interrupted SST asset paths ([d86df47](https://github.com/guidefari/gbfm/commit/d86df476810b6bf960d5dd1ce8d4887cc2dbda23))

# [2.84.0](https://github.com/guidefari/gbfm/compare/v2.83.0...v2.84.0) (2026-08-08)


### Bug Fixes

* **ci:** stop building retired backup image ([7d3275e](https://github.com/guidefari/gbfm/commit/7d3275e1e6006e0e86f53064e60fcd4d2aea4c9d))
* **http:** provide identity resolver to router ([afc0873](https://github.com/guidefari/gbfm/commit/afc0873cb9cefb57efc14aca5c799546f20d42c9))
* **observability:** batch named local traces ([a9d7632](https://github.com/guidefari/gbfm/commit/a9d76321e0d3ebf549e01204aeb91e07df8b605f))
* **tweet-nav:** resume navigation session ([f7c1fcf](https://github.com/guidefari/gbfm/commit/f7c1fcf7858704da9c3871677f64f384c05b2d24))
* **vps:** compute navigation read capabilities ([fa81735](https://github.com/guidefari/gbfm/commit/fa81735ea461c5bde58058b9433cf4a1fa8447c8))
* **vps:** isolate scheduled maintenance failures ([66b3c1c](https://github.com/guidefari/gbfm/commit/66b3c1c838ce8c486475de2b61dcd82f95c8790a))
* **vps:** map missing navigation opens to not found ([885c0fa](https://github.com/guidefari/gbfm/commit/885c0fa42ede20db2819c29be3f1b614ffa6f094))
* **vps:** preserve navigation session identity ([726711d](https://github.com/guidefari/gbfm/commit/726711d7afd69f2a42341a37eb3dccb20bca14bd))
* **vps:** reopen evicted navigation entries ([cbe7bf5](https://github.com/guidefari/gbfm/commit/cbe7bf556288d22a26181165c3c8c952be6f5fae))
* **vps:** scope device token cookie to origin ([fa9f5c4](https://github.com/guidefari/gbfm/commit/fa9f5c4b3b157252d3560b1b2603fd526645a915))
* **www:** drop hover styles on disabled tweet arrows ([34616a7](https://github.com/guidefari/gbfm/commit/34616a786fb9383d9ee9db65e2d19812c3afa849))
* **www:** update navigation capabilities atom ([e1257d4](https://github.com/guidefari/gbfm/commit/e1257d4c2ce26b63463840474ebba44ab5e0e49f))


### Features

* **api:** add micro post navigation contract ([f582541](https://github.com/guidefari/gbfm/commit/f5825416c900b06c34b7d7a8754744d31c8c2ae9))
* **db:** add navigation session migration ([95a775c](https://github.com/guidefari/gbfm/commit/95a775c64b0375af91b3e648a7e1c60d21c4b00a))
* **db:** add navigation session schema ([76f2e67](https://github.com/guidefari/gbfm/commit/76f2e67c29d39b614d24ecee7ed05b7b2cb727cb))
* **migration:** verify R2 object parity ([3293885](https://github.com/guidefari/gbfm/commit/32938852e3960d99fbe65db562127d57510f013d))
* **observability:** trace navigation requests ([31048cd](https://github.com/guidefari/gbfm/commit/31048cd4d436445ebb48dd28945c16586f9480c1))
* **storage:** add provider configuration ([67028ca](https://github.com/guidefari/gbfm/commit/67028ca797a07e08915ed923a4ddc80f842db386))
* **storage:** construct object store clients ([0627a38](https://github.com/guidefari/gbfm/commit/0627a383cd53bf378d0b49a195d26f9c37212fc9))
* **storage:** deploy R2 CDN router ([ed169f7](https://github.com/guidefari/gbfm/commit/ed169f749f06ebee4c5f20f396e3196b8a1784ab))
* **tweet-nav:** preload navigation neighbours ([d006d80](https://github.com/guidefari/gbfm/commit/d006d8061a2a23ddaf9688ce0b3c81dccaa9dfd5))
* **vps:** add navigation domain transitions ([2890f09](https://github.com/guidefari/gbfm/commit/2890f096f83ac0b4981eb07934c24f4adcc9b0da))
* **vps:** add optional navigation identity resolver ([995f834](https://github.com/guidefari/gbfm/commit/995f834479df99b4a453ad4fa482d24c797719af))
* **vps:** persist navigation session transitions ([b6467f8](https://github.com/guidefari/gbfm/commit/b6467f841e04f20d0077a3538085a80cc9a69679))
* **vps:** scaffold navigation session service ([1f35db3](https://github.com/guidefari/gbfm/commit/1f35db309b075ad5d1560eb639f7b13de8e9caec))
* **vps:** serve micro post navigation ([ca9c663](https://github.com/guidefari/gbfm/commit/ca9c6637f1a6b386f2067bea31acc34a6cfc87d4))
* **vps:** sweep expired anonymous navigation sessions ([2325960](https://github.com/guidefari/gbfm/commit/2325960c259fbbcdd5012bd9d4d343c52a11e32b))
* **www:** add navigation command client ([ac1e83e](https://github.com/guidefari/gbfm/commit/ac1e83ec6c9d0cf7834e1454250103ffa8d0abb2))
* **www:** navigate tweets with commands ([0768457](https://github.com/guidefari/gbfm/commit/07684574306b15001bbc89c0f47b4f939ab551f9))
* **www:** open tweets through navigation session ([a170110](https://github.com/guidefari/gbfm/commit/a1701105c9a849cbf1bb846e294cca65a429fe65))

# [2.83.0](https://github.com/guidefari/gbfm/compare/v2.82.0...v2.83.0) (2026-08-08)


### Bug Fixes

* **api:** move random exclusions to post body ([cd4cbeb](https://github.com/guidefari/gbfm/commit/cd4cbebfcf9b577fc2300e19916835e0ee4b98c3))
* **bluesky:** harden sync event protocol ([f9f51c0](https://github.com/guidefari/gbfm/commit/f9f51c0bfb157ff3abaae28bad80945eb8be3a08))
* **bluesky:** preserve imported post dates ([89d820f](https://github.com/guidefari/gbfm/commit/89d820f4e2bfc74acf7a03cb025899247543f383))
* **bluesky:** repair dates on reimport ([8de08ec](https://github.com/guidefari/gbfm/commit/8de08ecbf9ee206171c73d7d2ede77a4061422b4))
* **bluesky:** require post-create role to import ([2602952](https://github.com/guidefari/gbfm/commit/2602952a168a40c8f9dc6516c870b05a04bab90f))
* **bluesky:** skip unresolved music entities ([42ee7e3](https://github.com/guidefari/gbfm/commit/42ee7e3c80e32f17e4d081a9290a0040929d28ad))
* **logging:** classify client aborts ([b68ebed](https://github.com/guidefari/gbfm/commit/b68ebed7560ef3d4934b8ef53dad41dc9005d507))
* **logging:** omit query strings from request logs ([4cb6351](https://github.com/guidefari/gbfm/commit/4cb6351862fbea935d01da837b16d0585ff37ba2))
* **logging:** parse relative request URLs ([32115a5](https://github.com/guidefari/gbfm/commit/32115a556bc3134ea026e5ee46a8ecbc6123c72f))
* **logging:** preserve annotations and limit sentry logs ([7fbe291](https://github.com/guidefari/gbfm/commit/7fbe291ccd13d59a9de5899f47d7c54b82141e90))
* **logging:** retain app logger in request fibers ([c6ecd3c](https://github.com/guidefari/gbfm/commit/c6ecd3c615bb36e2e2624e481fab17d55ac68281))
* **nav:** remove station loading skeleton ([5b0017e](https://github.com/guidefari/gbfm/commit/5b0017e4ecd47c619bc673d6b572d5c3b123110d))
* **vps:** repair local request handling ([97ff116](https://github.com/guidefari/gbfm/commit/97ff11628ba8111c419f043d0b5f12977ceeed34))
* **www:** add search query clear button ([b2af59f](https://github.com/guidefari/gbfm/commit/b2af59f015b6ccb988ef88b4c63b85e00dc9e94e))
* **www:** hold tweet arrow slots and tie reply count to its thread ([818f995](https://github.com/guidefari/gbfm/commit/818f995389c20c2722de5e15a1fe6ba09b12bacb))
* **www:** keep floating elements clear of the bottom nav ([3d4c1ba](https://github.com/guidefari/gbfm/commit/3d4c1ba59662f5f6d19ce10a52ff51f8f4ab44ac))
* **www:** serialize tweet navigation intents ([495bfd2](https://github.com/guidefari/gbfm/commit/495bfd20088530279df53c0fc1d2ca4542514019))
* **www:** standardize reply actions ([32dce34](https://github.com/guidefari/gbfm/commit/32dce34c7aef54355ec2cb989de31ce65e7f7bf0))
* **www:** stop infinite redirect loop on dashboard content routes ([3b3e8a9](https://github.com/guidefari/gbfm/commit/3b3e8a9e0729b230692fe025efcd091ba0ee82fe))


### Features

* admin/creator can see draft content ([17ad06a](https://github.com/guidefari/gbfm/commit/17ad06a8cd8dd8756bd550a2091002acdb1ff06a))
* **admin:** add offset based table pagination control ([e2b025d](https://github.com/guidefari/gbfm/commit/e2b025d27de8d652424d1317ab6f55f864a27952))
* **admin:** persist content table state in the url ([c5361bf](https://github.com/guidefari/gbfm/commit/c5361bf8d400dbf03104a539f681e3b3664875a0))
* **audio:** sort managed mixes server side ([9326256](https://github.com/guidefari/gbfm/commit/9326256a3c6932771a50777920d55db4d4e4e98e))
* **bluesky:** add archive sync control ([a8bee8c](https://github.com/guidefari/gbfm/commit/a8bee8c1d7bd900bee37a2975f548d14d27bc508))
* **bluesky:** add external account schema ([5bc379d](https://github.com/guidefari/gbfm/commit/5bc379d12940949be4163353ce8370a9a52b85ef))
* **bluesky:** add sync event stream ([e94948a](https://github.com/guidefari/gbfm/commit/e94948aa04c3d3140626ae7948b8ee5948e8adf5))
* **bluesky:** detect source conflicts ([bc2767a](https://github.com/guidefari/gbfm/commit/bc2767a56fc606431b92d17549522bcc0a813708))
* **bluesky:** expose account integration API ([f6f96ad](https://github.com/guidefari/gbfm/commit/f6f96adf0164e4ff18688e9ed682e01b00df5a9c))
* **bluesky:** expose Effect import boundary ([b9e45b9](https://github.com/guidefari/gbfm/commit/b9e45b90c0a1316cfdc0fa7f1d0fd93006222b88))
* **bluesky:** expose sync runs and source status ([196d75a](https://github.com/guidefari/gbfm/commit/196d75ab40057834bf83505996f84d22c86e33aa))
* **bluesky:** normalize music import signals ([7bacda2](https://github.com/guidefari/gbfm/commit/7bacda2f7c7977c5a2e4c4412ce97643d2a69054))
* **bluesky:** page bounded archive sync ([febfb1c](https://github.com/guidefari/gbfm/commit/febfb1c9b1599525e7f44c7ba2c1d7f1e212a52f))
* **bluesky:** persist connected accounts ([fbe96a1](https://github.com/guidefari/gbfm/commit/fbe96a15d4189b024b6a0e12ca255f89019519bb))
* **bluesky:** queue manual syncs ([e251ae7](https://github.com/guidefari/gbfm/commit/e251ae7193d1fd40c55d3b63c2bb55cdbb23d769))
* **bluesky:** refresh sync sessions ([5687ebf](https://github.com/guidefari/gbfm/commit/5687ebf83945a2b041fb5b4ecb047aae82325fc2))
* **bluesky:** resolve imported music entities ([2768662](https://github.com/guidefari/gbfm/commit/2768662e6624e69bdb41e157a99f66745658b6e3))
* **bluesky:** run durable archive sync ([ae444db](https://github.com/guidefari/gbfm/commit/ae444dba471987aa9c46c1d40f62e2119aaefc2c))
* **bluesky:** schedule opted-in syncs ([bcf599b](https://github.com/guidefari/gbfm/commit/bcf599b108035313e9f5ac307200406332f0d371))
* **bluesky:** stream sync progress ([f5d5ca4](https://github.com/guidefari/gbfm/commit/f5d5ca46c0332b88c4db40212ebe83894367b392))
* **bluesky:** surface source attribution ([301f927](https://github.com/guidefari/gbfm/commit/301f9278ce7145fd9ee33a96e7ffcc59ab7a04c5))
* **bluesky:** unify connect, sync, and draft review on one page ([aebd8a9](https://github.com/guidefari/gbfm/commit/aebd8a9dade4beb9840cce09b8c392105fc060ff))
* **bluesky:** verify app password identity ([6e5cb34](https://github.com/guidefari/gbfm/commit/6e5cb34a5943e597811d501fec0dc70065edd606))
* **bluesky:** write imported archive posts ([06139c3](https://github.com/guidefari/gbfm/commit/06139c3c799840f3982734512256300c7a867f08))
* **dashboard:** add bluesky imports surface ([adc4b16](https://github.com/guidefari/gbfm/commit/adc4b163ce14000a83bd6104e765a9a76620b882))
* **dashboard:** add personal content surface ([ad8b699](https://github.com/guidefari/gbfm/commit/ad8b6993c47820d08fd21f8abfc46192e9afc9ae))
* **infrastructure:** add database lock service ([3c59923](https://github.com/guidefari/gbfm/commit/3c59923a8b65f3f29eab23bf5bcdf6614f0b7a22))
* **logging:** emit one structured request event ([760f128](https://github.com/guidefari/gbfm/commit/760f1287dfad23f79d9bd87a78f105713c1ed73f))
* **posts:** filter managed posts by source, status, and query ([7a013cc](https://github.com/guidefari/gbfm/commit/7a013cc765316ac9f3dde507828e0f0d531317ff))
* **search:** add global content search ([b078281](https://github.com/guidefari/gbfm/commit/b07828162f801afca4c0d3d8f9326c68a6049def))
* **security:** add encrypted secret service ([da5044e](https://github.com/guidefari/gbfm/commit/da5044e50e7f73790590314eb545b2f6c94a1d11))
* **studio:** one workspace shell and a page per content type ([4fdb791](https://github.com/guidefari/gbfm/commit/4fdb7910c1f3e3689c1319fa779a8c13c3471721))
* **www:** add hold-to-random navigation ([af53b48](https://github.com/guidefari/gbfm/commit/af53b4833f4d01a1916f54d2983f8e8b4c360027))
* **www:** add ring logo mark to the desktop nav ([2043120](https://github.com/guidefari/gbfm/commit/20431202b788d2509fdf9bbdfae4f283cb589619)), closes [414042/#A58730](https://github.com/guidefari/gbfm/issues/A58730)
* **www:** add tweet card actions ([4796581](https://github.com/guidefari/gbfm/commit/4796581eba9c0fe70f6e557040fb6447f6451caf))
* **www:** centralize service integrations ([0f120b2](https://github.com/guidefari/gbfm/commit/0f120b2612c5509c75c0d55062f0445e63aa18ef))
* **www:** flank tweet prev/next arrows on desktop ([2ad11b9](https://github.com/guidefari/gbfm/commit/2ad11b9d2cde6f8d2739933eb9e21a8af1dd3753))
* **www:** inline reply-to-a-reply with capped nesting ([0269d03](https://github.com/guidefari/gbfm/commit/0269d03bc7331b08f7955fcd1770ea6f076c3b0a))
* **www:** move desktop nav to the bottom ([af50935](https://github.com/guidefari/gbfm/commit/af509354033bc3657c794ee701f55d974e31d9ec))
* **www:** restore real goosebumps logo art with hover motion ([036845a](https://github.com/guidefari/gbfm/commit/036845aafd9dc95c36d1b16fb99da16057f335e1))
* **www:** static desktop nav, fold admin into dashboard ([3c7ef1a](https://github.com/guidefari/gbfm/commit/3c7ef1ab9ddd1b282968d206e3e414bda02cb348))
* **www:** white logo mark only, no wordmark ([9628e8f](https://github.com/guidefari/gbfm/commit/9628e8f0f1eff75de496c7f5111983b9da5ad38f))

# [2.82.0](https://github.com/guidefari/gbfm/compare/v2.81.1...v2.82.0) (2026-08-01)


### Features

* **www:** add tags index page ([a2ae1f5](https://github.com/guidefari/gbfm/commit/a2ae1f5c078eaa13d63271a96b3f9b2a960a3efa))
* **www:** link tags as hashtags to a tag page ([81fa3da](https://github.com/guidefari/gbfm/commit/81fa3da1e5fd2dcb3d43ca54def0295cd244acc8)), closes [#hashtag](https://github.com/guidefari/gbfm/issues/hashtag)
* **www:** render full post content on tag pages ([1e8f992](https://github.com/guidefari/gbfm/commit/1e8f992530c393d32a20f02c06e19aea1dc25881))

## [2.81.1](https://github.com/guidefari/gbfm/compare/v2.81.0...v2.81.1) (2026-08-01)


### Bug Fixes

* **www:** restore control clicks inside tweet replies ([e05bed0](https://github.com/guidefari/gbfm/commit/e05bed0476e06de2ad5a2bd9a32c571266311729))
* **www:** unify stream control sizing on music cards ([b1055f7](https://github.com/guidefari/gbfm/commit/b1055f72e6951c577edef99ec52a02e5c2b6b562))

# [2.81.0](https://github.com/guidefari/gbfm/compare/v2.80.0...v2.81.0) (2026-08-01)


### Bug Fixes

* style ([3fc91c0](https://github.com/guidefari/gbfm/commit/3fc91c00987df61fb24699ae65c27558ad83f672))
* **www:** stop tweet nav arrows from also skipping tracks ([1d71355](https://github.com/guidefari/gbfm/commit/1d713557223c374af12e6d9659561daadfa49d0c))


### Features

* indicate reply count on tweet ([3072f3a](https://github.com/guidefari/gbfm/commit/3072f3ab6588b55a0ddc51c5906473d45176c618))
* **www:** add tweet entry actions ([bb2870b](https://github.com/guidefari/gbfm/commit/bb2870b1da3e8894dd8cac21ff0640b2bdfa2257))
* **www:** auto-detect quoted tweet from body text ([526a4cc](https://github.com/guidefari/gbfm/commit/526a4cc5ee51bcffad3a7e9cdd5ae4d98759a2bc))
* **www:** link tweet replies and parents ([69c95f1](https://github.com/guidefari/gbfm/commit/69c95f19b7690527e7eeee1a608adac97303c9fa))
* **www:** make tweets the canonical landing route ([c7db133](https://github.com/guidefari/gbfm/commit/c7db133a6e6bf2ff799e0d2fd1acdb15143372ae))
* **www:** persist tweet browse progress ([f0b2ee5](https://github.com/guidefari/gbfm/commit/f0b2ee566770427164dac62c2bd922fc63e705fe))
* **www:** record loaded tweet progress ([e3667a1](https://github.com/guidefari/gbfm/commit/e3667a1bf24281b289b622e266801d22d968545d))

# [2.80.0](https://github.com/guidefari/gbfm/compare/v2.79.0...v2.80.0) (2026-08-01)


### Bug Fixes

* test ([d6fba22](https://github.com/guidefari/gbfm/commit/d6fba22cc942fb6b084f740a1d9751710a617e45))
* **vps:** exclude replies from prev/next and random tweet nav ([9d378d2](https://github.com/guidefari/gbfm/commit/9d378d24c465e6519d37e723bc11a99e4556c32e))
* **www:** show matched artist/track in tweet search results ([737cd61](https://github.com/guidefari/gbfm/commit/737cd616ad90da7c4f688ba7f998a00768d5ec09))


### Features

* support music entity embeds on tweet replies ([65c1928](https://github.com/guidefari/gbfm/commit/65c19281d15abcb6607f192c8288b0a63347272d))
* tweet ux ([0bdffa9](https://github.com/guidefari/gbfm/commit/0bdffa90c388378667ea2686ceb7fbce81a73932))
* **vps:** add community reply endpoint + fix missing create-post role gate ([f31c687](https://github.com/guidefari/gbfm/commit/f31c687c35d7eee334eccd820e71e9e104fd862e))
* **vps:** add direct replies read endpoint ([32641c4](https://github.com/guidefari/gbfm/commit/32641c4929ccfdda87b0a127419ed77d12956b54))
* **vps:** add full thread read endpoint ([a4d3b85](https://github.com/guidefari/gbfm/commit/a4d3b853414dcc019159bfdf80ae5e01237916d7))
* **vps:** add quote-tweet backend (quotedPostId) ([26567d1](https://github.com/guidefari/gbfm/commit/26567d1c729efb28444ab8277ab95af6aea561e1))
* **vps:** add thread fields to posts schema (parentPostId, rootPostId, depth) ([dc2c97b](https://github.com/guidefari/gbfm/commit/dc2c97b11af19a9b56e38256b5c2c3779d34b3bf))
* **vps:** exclude replies from tweet feed, add createMicroPostReply ([47867bf](https://github.com/guidefari/gbfm/commit/47867bf301ec611db72058743d9a6e44f01cbea9))
* **vps:** make slug optional on generic post create ([6765485](https://github.com/guidefari/gbfm/commit/67654858192e674446af12f2a79adfee39cfd704))
* **vps:** reject non-replyable and invisible reply parents ([20d2693](https://github.com/guidefari/gbfm/commit/20d269315f13073777c40bb5677c8cc7f0cdfa96))
* **vps:** strip thread fields from post update payload (defense-in-depth) ([aaba8cd](https://github.com/guidefari/gbfm/commit/aaba8cda9806c976460c0794cd40f80601c8a673))
* **www:** add flat reply UI to the tweet page ([3a21807](https://github.com/guidefari/gbfm/commit/3a2180713fa9ac321473ef90577dccf0d5c286ab))
* **www:** add floating compose button on tweet page ([c5a3e87](https://github.com/guidefari/gbfm/commit/c5a3e871df29d57d4adb4cc6a99d97cec86f5fab))
* **www:** add listen-reminder button to tweet music entity card ([b6d1846](https://github.com/guidefari/gbfm/commit/b6d1846d7a5890446fc81b98985ddd90e7daee58))
* **www:** quote-tweet UI in both composers and tweet/reply rendering ([a9669d7](https://github.com/guidefari/gbfm/commit/a9669d77e98f9a96b56b07abf707e33b46e86aa7))

# [2.79.0](https://github.com/guidefari/gbfm/compare/v2.78.0...v2.79.0) (2026-08-01)


### Features

* tweet styles ([cbd06e4](https://github.com/guidefari/gbfm/commit/cbd06e46f7213fdc061bbf197461a81efe06575f))

# [2.78.0](https://github.com/guidefari/gbfm/compare/v2.77.0...v2.78.0) (2026-08-01)


### Features

* tweets ux ([d595a10](https://github.com/guidefari/gbfm/commit/d595a10e11a07881ec165b7441c94d7fc4901a60))

# [2.77.0](https://github.com/guidefari/gbfm/compare/v2.76.7...v2.77.0) (2026-08-01)


### Bug Fixes

* **theme:** format generated css so ci passes ([0cfdd3c](https://github.com/guidefari/gbfm/commit/0cfdd3c8f67ebe1aaf6ea49835a0556c1e73d7c9))
* **theme:** make destructive foreground readable in dark ([5bb5cdd](https://github.com/guidefari/gbfm/commit/5bb5cddd1b1d3ed1e654034d60d2ed45a0dcb3ea))
* **ui:** animate sheets with tailwindcss-animate ([938d825](https://github.com/guidefari/gbfm/commit/938d82580bb0bd33e72f146eee16b7ff1910d974))
* **ui:** apply artwork hover ring to wrapper ([246f9f3](https://github.com/guidefari/gbfm/commit/246f9f31f0e670bb5a33f10ca68faf750929a73a))
* **ui:** declare animation keyframes in ui package ([265fcbe](https://github.com/guidefari/gbfm/commit/265fcbe5b12ceffb9706361309e24b6bb08a285c))
* **ui:** follow system theme in ladle ([9c68d2c](https://github.com/guidefari/gbfm/commit/9c68d2c6245ffdf070f7b66d4b1db6395946b497))
* **ui:** match shows skeleton to the real shows layout ([68a3176](https://github.com/guidefari/gbfm/commit/68a3176151eb23be0c66e491062eadc207dedd7b))
* **ui:** scope sheet close button to custom headers ([6f1f943](https://github.com/guidefari/gbfm/commit/6f1f94397f8b7f0cc6aaf0847915ecff24347159))
* **ui:** stop play toggle label shifting layout ([64dffd8](https://github.com/guidefari/gbfm/commit/64dffd8ee9004347e21c6571371761aa9a7d242c))
* **www:** dedupe Home in nav menu, align Follow icons, hide scrollbar ([8cfebcf](https://github.com/guidefari/gbfm/commit/8cfebcfb62a35e6595a7139689c77ef21f30a9d7))
* **www:** dedupe Radio Shows nav entry, restore history on mix back-link ([1dc2267](https://github.com/guidefari/gbfm/commit/1dc22673b5d972a6dcb43daa6af14b67fa16fdfa))
* **www:** keep episode play control next to the title ([1bb6c15](https://github.com/guidefari/gbfm/commit/1bb6c15e989a1657fd582c0d1c6102e93ba6d0e5))
* **www:** scrollbar-hide utility not compiling ([11b4085](https://github.com/guidefari/gbfm/commit/11b408503d34ed07b080f7340c21520d40d746fc))
* **www:** show loading feedback while a track buffers ([90d3213](https://github.com/guidefari/gbfm/commit/90d32137816ce03c76ee90cbadd129339b227da6))
* **www:** wire favorite button in fullscreen player ([8f4351e](https://github.com/guidefari/gbfm/commit/8f4351e7b7ca3aaf053f5f8313acb90744a85023))


### Features

* **ui:** add Artwork and PlayToggle primitives ([3baff2a](https://github.com/guidefari/gbfm/commit/3baff2a027e5e3a88803797f7df70e75800e1171))
* **vps:** add episode number backfill script ([2b080b7](https://github.com/guidefari/gbfm/commit/2b080b76f2ee5e718041309e910fe1637d8f5e5d))
* **www:** desktop top bar and mobile bottom tabs for nav ([7ff13af](https://github.com/guidefari/gbfm/commit/7ff13af63ae66ccab0dd9aa5ed00e637f00bfcb0))
* **www:** drop desktop mini player for fullscreen playback ([2dd4d16](https://github.com/guidefari/gbfm/commit/2dd4d1665449f6b0663f3cb3539af8302c8c3d45))
* **www:** drop the every mix feed for browse by show ([7cf96ad](https://github.com/guidefari/gbfm/commit/7cf96ad3baef487a0d2d0364b14055b69eac12c3))
* **www:** native view transitions on route navigation ([fdaaa04](https://github.com/guidefari/gbfm/commit/fdaaa04e10c065f98eab35a113e4193266041902))
* **www:** persistent desktop dock with now-playing chip ([dd42319](https://github.com/guidefari/gbfm/commit/dd4231956a9df3977a0babbeea86f0c903542a09))
* **www:** persistent mini-player tab, thicker progress ticker ([eaf3ec3](https://github.com/guidefari/gbfm/commit/eaf3ec30766d57d2c2f5bf05f714adfa4506ff99))
* **www:** playback progress ticker in desktop chrome ([40003cf](https://github.com/guidefari/gbfm/commit/40003cf7626d994798834b9ab3601a4b908a3007))
* **www:** redesign episode rows and show rail for scanability ([2eb03c1](https://github.com/guidefari/gbfm/commit/2eb03c14ca0e2356d3bd1ef2e1641a0702371bd5))
* **www:** replace floating menu with a station nav ([12edf93](https://github.com/guidefari/gbfm/commit/12edf933c69014dc2a2041f5ec93b5e77d98cd00))
* **www:** richer episode rows on shows browse ([1cf1910](https://github.com/guidefari/gbfm/commit/1cf19100afc515b34af252637b32f7d06cb0fcd4))
* **www:** sticky show context bar on browse page ([9f6353a](https://github.com/guidefari/gbfm/commit/9f6353a5d8d7d9abf41adce9174d249c45f2bb27))
* **www:** text-forward episode rows on shows browse ([518b54f](https://github.com/guidefari/gbfm/commit/518b54f69fc0843b1fa74537473ca12feac1de70))
* **www:** tighten shows browse layout and match skeletons ([21aa04d](https://github.com/guidefari/gbfm/commit/21aa04d6933aa10da2a38b9d6d89e7f6f9448f8c))

## [2.76.7](https://github.com/guidefari/gbfm/compare/v2.76.6...v2.76.7) (2026-07-31)


### Bug Fixes

* **ci:** avoid rollout gate false failures ([a5506a3](https://github.com/guidefari/gbfm/commit/a5506a3cb49d429f2fd94dbdd1cdf18948159641))
* **ci:** budget telemetry verification phases ([03c46d9](https://github.com/guidefari/gbfm/commit/03c46d9e69fa5f26ea3b33924380e26acc51aec1))
* **ci:** harden production verification gate ([dafd0c5](https://github.com/guidefari/gbfm/commit/dafd0c5edaa1fcf9e7c492e75d13b08b0eeb9fb0))
* **ci:** identify primary ECS deployment ([204a5c0](https://github.com/guidefari/gbfm/commit/204a5c0321fa3a9b0a19cbcb9ecf47db71e65cac))
* **ci:** wait for telemetry convergence ([a286e59](https://github.com/guidefari/gbfm/commit/a286e59ce7e750b62717f4dd890f349fe5821c40))

## [2.76.6](https://github.com/guidefari/gbfm/compare/v2.76.5...v2.76.6) (2026-07-30)


### Bug Fixes

* **vps:** prevent raw SQL telemetry ([3b9bdac](https://github.com/guidefari/gbfm/commit/3b9bdacf3b5b17c7161a2998f83f41e403330ace))

## [2.76.5](https://github.com/guidefari/gbfm/compare/v2.76.4...v2.76.5) (2026-07-30)


### Bug Fixes

* **vps:** unify OpenTelemetry provider ([078c4b2](https://github.com/guidefari/gbfm/commit/078c4b23d56841b939fd963acee096ea13e26ca5))

## [2.76.4](https://github.com/guidefari/gbfm/compare/v2.76.3...v2.76.4) (2026-07-30)


### Bug Fixes

* **vps:** register database tracing provider ([998321d](https://github.com/guidefari/gbfm/commit/998321d4df94f689d1a2735f0a36bc3cca85d344))

## [2.76.3](https://github.com/guidefari/gbfm/compare/v2.76.2...v2.76.3) (2026-07-30)


### Bug Fixes

* **vps:** trace queries at the pool boundary ([dd14fbe](https://github.com/guidefari/gbfm/commit/dd14fbe6a7c509259251326dd957c30b4b4b2801))

## [2.76.2](https://github.com/guidefari/gbfm/compare/v2.76.1...v2.76.2) (2026-07-30)


### Bug Fixes

* **vps:** join database spans to Effect context ([4dfc332](https://github.com/guidefari/gbfm/commit/4dfc33218af5d063f2aa91abbaf4485e600d3fda))

## [2.76.1](https://github.com/guidefari/gbfm/compare/v2.76.0...v2.76.1) (2026-07-30)


### Bug Fixes

* **vps:** instrument pg at runtime boundary ([c39bc3f](https://github.com/guidefari/gbfm/commit/c39bc3fd157584c06c7574090552f704a4df7f5c))

# [2.76.0](https://github.com/guidefari/gbfm/compare/v2.75.4...v2.76.0) (2026-07-30)


### Bug Fixes

* close observability review gaps ([dbde52f](https://github.com/guidefari/gbfm/commit/dbde52f240ae7853c334a47941d9b3d0791b7160))


### Features

* harden production observability ([224cf4a](https://github.com/guidefari/gbfm/commit/224cf4a14ba615c3ec3f7baa2d9ffe0582f95731))

## [2.75.4](https://github.com/guidefari/gbfm/compare/v2.75.3...v2.75.4) (2026-07-30)


### Bug Fixes

* **vps:** centralize creator membership and cover relational query paths ([bdfcf5b](https://github.com/guidefari/gbfm/commit/bdfcf5b99f4dd3165c3a1c5357a8ebe950f174a2))
* **vps:** correlate creator filters via inArray in relational queries ([7f59103](https://github.com/guidefari/gbfm/commit/7f59103f123ce7b55d44beb261dec2c0e897a69a))

## [2.75.3](https://github.com/guidefari/gbfm/compare/v2.75.2...v2.75.3) (2026-07-30)


### Bug Fixes

* **vps:** resolve audio thumbnailUrl from show at read time instead of copying at write time ([993dbc8](https://github.com/guidefari/gbfm/commit/993dbc8d1ec05085a9184bb1238a4b8654ba75e6))

## [2.75.2](https://github.com/guidefari/gbfm/compare/v2.75.1...v2.75.2) (2026-07-27)


### Bug Fixes

* **vps:** include creators when fetching show episodes ([a19830b](https://github.com/guidefari/gbfm/commit/a19830bb42468b7344f4cef0fda17ab8b19cae1b))
* **vps:** use Drizzle relational queries for creators/hosts ([c8e6dda](https://github.com/guidefari/gbfm/commit/c8e6dda0381dceeecbac3299d6dcdd4a2831cd2d))

## [2.75.1](https://github.com/guidefari/gbfm/compare/v2.75.0...v2.75.1) (2026-07-26)


### Bug Fixes

* **player:** arm completion after playback starts ([147dde4](https://github.com/guidefari/gbfm/commit/147dde4ca1777925ed78d35b3f6d94195fc597ff))
* **www:** finish media session layer rename ([4d54bb5](https://github.com/guidefari/gbfm/commit/4d54bb57328e078a2bfb8fe60c8b2fae8e803841))

# [2.75.0](https://github.com/guidefari/gbfm/compare/v2.74.0...v2.75.0) (2026-07-26)


### Features

* **uploads:** images direct-to-S3 presign + upload-asset lifecycle table ([#225](https://github.com/guidefari/gbfm/issues/225)) ([4af56d6](https://github.com/guidefari/gbfm/commit/4af56d6daad470c0a9facfe12f7938c3ac593958)), closes [#220](https://github.com/guidefari/gbfm/issues/220) [#220](https://github.com/guidefari/gbfm/issues/220)

# [2.74.0](https://github.com/guidefari/gbfm/compare/v2.73.0...v2.74.0) (2026-07-26)


### Features

* **uploads:** switch multipart part upload to direct-to-S3 presigned URLs ([#220](https://github.com/guidefari/gbfm/issues/220)) ([10d43a3](https://github.com/guidefari/gbfm/commit/10d43a33e612d65cc6ae19e5ad196b404802941d))

# [2.73.0](https://github.com/guidefari/gbfm/compare/v2.72.1...v2.73.0) (2026-07-26)


### Features

* **music:** add factual label affiliations ([#219](https://github.com/guidefari/gbfm/issues/219)) ([f1e7a31](https://github.com/guidefari/gbfm/commit/f1e7a31aefb480d3e0b5199d0008868c4a7d8e28))

## [2.72.1](https://github.com/guidefari/gbfm/compare/v2.72.0...v2.72.1) (2026-07-25)


### Bug Fixes

* **admin:** report label creation failures ([686c601](https://github.com/guidefari/gbfm/commit/686c60119bca66e7ef6f6dcbe7b61257b331a336))
* **db:** preserve label creator provenance ([fe6ca65](https://github.com/guidefari/gbfm/commit/fe6ca653de1e97782b062cdeacc41749e7f99c0e))
* **mobile:** type playback rejection ([6d46d92](https://github.com/guidefari/gbfm/commit/6d46d92a33104d5e06d9fa7ac427e5e8916cca13))
* **player:** reject stale source status ([011b8ad](https://github.com/guidefari/gbfm/commit/011b8addfd57666df3516328ea3a8590c11e3bf5))
* **www:** restore fullscreen player state ([9c1666f](https://github.com/guidefari/gbfm/commit/9c1666fe2d1068735b6eb37cb058deb3db2d8b31))
* **www:** restore player source integrations ([d09a0f9](https://github.com/guidefari/gbfm/commit/d09a0f9f88bbcdfb37a78dddfb907762001ddb55))

# [2.72.0](https://github.com/guidefari/gbfm/compare/v2.71.1...v2.72.0) (2026-07-25)


### Features

* **music:** migrate labels to music entities ([#217](https://github.com/guidefari/gbfm/issues/217)) ([d16e10e](https://github.com/guidefari/gbfm/commit/d16e10e999fc91751cd51c0c1246d3b2e6dc270a))

## [2.71.1](https://github.com/guidefari/gbfm/compare/v2.71.0...v2.71.1) (2026-07-25)


### Bug Fixes

* **player:** restore position for cached sources ([1053a54](https://github.com/guidefari/gbfm/commit/1053a54a6217a102e3c284aa55ed40d1c7b4ce5b))

# [2.71.0](https://github.com/guidefari/gbfm/compare/v2.70.1...v2.71.0) (2026-07-25)


### Features

* **spotify:** extract shared package and add mobile playback ([#215](https://github.com/guidefari/gbfm/issues/215)) ([4fdf4ab](https://github.com/guidefari/gbfm/commit/4fdf4ab7d24a278e523644b59f06cadfaaf042b2)), closes [#208](https://github.com/guidefari/gbfm/issues/208)

## [2.70.1](https://github.com/guidefari/gbfm/compare/v2.70.0...v2.70.1) (2026-07-25)


### Bug Fixes

* lockfile ([b361ba6](https://github.com/guidefari/gbfm/commit/b361ba6339e8567f2da3365fb63447540d4ae715))
* **tweet:** restore scroll position on back navigation ([c65a8c6](https://github.com/guidefari/gbfm/commit/c65a8c6dd266dc816cb1649ae7ee06103aecae4f))

# [2.70.0](https://github.com/guidefari/gbfm/compare/v2.69.0...v2.70.0) (2026-07-25)


### Bug Fixes

* **music:** destructure status in useAddAdminEntityLink ([21a07af](https://github.com/guidefari/gbfm/commit/21a07af2cb05389b68984d94ec254b1c32ecdfa3))
* **spotify:** attribute Spotify branding on links and playback controls ([3de87e8](https://github.com/guidefari/gbfm/commit/3de87e884d79b5e2847debdf31d801091f1af6b0)), closes [#1DB954](https://github.com/guidefari/gbfm/issues/1DB954)
* **spotify:** compact play/queue buttons, drop redundant badge ([8707ace](https://github.com/guidefari/gbfm/commit/8707acec9f94c3756e2618e8bece682ebbdeed37))
* **spotify:** group entity actions after the platform link list ([a1ba145](https://github.com/guidefari/gbfm/commit/a1ba1459ade6567e5c539306a4af566564b259c8))
* **tweet:** gate music entity card skeleton on links query ([0845629](https://github.com/guidefari/gbfm/commit/08456298448ce3960e613691492e448f5b0e7b51))


### Features

* **observability:** route Effect spans into the existing Sentry tracer ([e09c3fe](https://github.com/guidefari/gbfm/commit/e09c3fed1463ef855fa13406a606f18e86bc6939))
* **spotify:** play and queue music entities from verified links ([d2c978f](https://github.com/guidefari/gbfm/commit/d2c978ff8e3f6b1df03223796f86535c592f1641)), closes [#207](https://github.com/guidefari/gbfm/issues/207) [#209](https://github.com/guidefari/gbfm/issues/209) [#210](https://github.com/guidefari/gbfm/issues/210)

# [2.69.0](https://github.com/guidefari/gbfm/compare/v2.68.0...v2.69.0) (2026-07-25)


### Bug Fixes

* **mobile:** restore active tab contrast ([521d6fe](https://github.com/guidefari/gbfm/commit/521d6fed91919a5c312592aa66094e12b9ac5c8f))


### Features

* **mobile:** add shared screen primitive ([1c085c2](https://github.com/guidefari/gbfm/commit/1c085c23c0f05c2fd3a73bdc31897e24aa1b90ea))
* **theme:** add semantic light-mode tokens ([8d44d8c](https://github.com/guidefari/gbfm/commit/8d44d8cc2ca74791437c2d748c884408ed0a1a49))

# [2.68.0](https://github.com/guidefari/gbfm/compare/v2.67.0...v2.68.0) (2026-07-25)


### Bug Fixes

* **content:** authorize draft management ([2031ddd](https://github.com/guidefari/gbfm/commit/2031dddb8fbaf0b79bd4c02ea8e4cc94ff38c0cd))
* **content:** keep drafts out of public surfaces ([214b322](https://github.com/guidefari/gbfm/commit/214b322efb1bdaf4fcee84097f11cf98a07bf0b4))
* **mobile:** advance playback reliably ([9a3f219](https://github.com/guidefari/gbfm/commit/9a3f2199fe34764f57d1923d5a4f46e786c5cc2d))
* **mobile:** make playback controls accessible ([ae45ab9](https://github.com/guidefari/gbfm/commit/ae45ab917aa53c270230550845672569264d106e))
* **mobile:** make playback queue deterministic ([4cef1a4](https://github.com/guidefari/gbfm/commit/4cef1a4c21ff7a2bcdeb20ec0303524ed13d4e1e))
* **mobile:** synchronize playback intent ([a18de4d](https://github.com/guidefari/gbfm/commit/a18de4db2b37db1d5f7818d717968e121a1bd201))
* **upload:** bind idempotency keys to requests ([f671c48](https://github.com/guidefari/gbfm/commit/f671c48f74cf14af5bd1404a48ba0c16847485ad))
* **upload:** clean up canceled multipart uploads ([a038405](https://github.com/guidefari/gbfm/commit/a0384050c037ef569a1d56d3f63dccca2645cc5a))
* **upload:** enforce retry-safe completion ([0b22e00](https://github.com/guidefari/gbfm/commit/0b22e0091a494ed26abcd233cf2aae292f01030b))


### Features

* **mobile:** confirm queued tracks with a toast ([3ba3897](https://github.com/guidefari/gbfm/commit/3ba38979c9c00a52e15c6c7e357cb3c0a2175ba1))
* **mobile:** redesign now-playing with theme-aware colors ([e14bdc3](https://github.com/guidefari/gbfm/commit/e14bdc3f981f5eb07845123608f5d18bbf15d6f9))

# [2.67.0](https://github.com/guidefari/gbfm/compare/v2.66.0...v2.67.0) (2026-07-23)


### Bug Fixes

* corss header ([0e4a68a](https://github.com/guidefari/gbfm/commit/0e4a68a7e403ba6e5bfcb35be9c30af7faa87aa9))
* corss header ([ee18805](https://github.com/guidefari/gbfm/commit/ee1880542c1f3dd5919101086b376313624091c7))
* **effect:** align Spotify SDK with beta.99 ([3938260](https://github.com/guidefari/gbfm/commit/3938260dbd3d900b523f05844d1a6ab06cd9a7bc))
* **mobile:** sync fonts ready flag in useEffect, not during render ([2729763](https://github.com/guidefari/gbfm/commit/27297637d7fbad3ed860fa51cc746822657222f1))
* use stack options ([50ad623](https://github.com/guidefari/gbfm/commit/50ad6233f0d7e20b04e952580d509d194426d646))
* **www:** import theme tokens via relative path in Vite plugin ([b09d5f7](https://github.com/guidefari/gbfm/commit/b09d5f7c7fc602ef0d440c911d2aebbf97947021))


### Features

* **dev:** expose mobile stack over Tailscale ([487ad8a](https://github.com/guidefari/gbfm/commit/487ad8a99caacf912671545d60786f1eded48388))
* mobile fonts ([e88d0b9](https://github.com/guidefari/gbfm/commit/e88d0b91abb20f8297ef0c4727fda04253bc6a19))
* mobile home page ([a6f84c9](https://github.com/guidefari/gbfm/commit/a6f84c95d7bfda217f70f483a844cad28094af7c))
* **mobile:** add expo-audio provider and secure persistent auth via expo-secure-store ([87b4577](https://github.com/guidefari/gbfm/commit/87b4577be1c7556fe219513cb9c708e14cec19a3))
* **mobile:** add native tabs and appearance settings ([7226210](https://github.com/guidefari/gbfm/commit/72262105498581af662e2b96e3a48bbc1c864c6f))
* **mobile:** add persistent playback queue ([06795bc](https://github.com/guidefari/gbfm/commit/06795bc1973f8c5872b3229393dafd56d71f6ebf))
* **mobile:** add tab layout, now-playing screen, and NowPlayingProvider ([5530048](https://github.com/guidefari/gbfm/commit/5530048753eae0c00b28f32d2ce2b05fb7366a27))
* **mobile:** migrate to @effect/atom-react@4, bump react 19.2.7 and effect 4.0.0-beta.99 ([691e9d8](https://github.com/guidefari/gbfm/commit/691e9d826061f59339151708982c49163fdabc1f))
* **mobile:** redesign home screen with featured mix and update profile with appearance section ([b16aa52](https://github.com/guidefari/gbfm/commit/b16aa529cc60cb84e2f1281261adc90f8fcb61c2))
* **mobile:** refine home screen hierarchy ([64f92e0](https://github.com/guidefari/gbfm/commit/64f92e0b02390607b03f84a17b9dbfbe465b7766))
* **mobile:** use Effect for authentication ([1a199ed](https://github.com/guidefari/gbfm/commit/1a199ed1fc8acaa7305f6dd67256e60a372b0ccd))
* **theme:** export brandDark and brandLight tokens ([c62a8f2](https://github.com/guidefari/gbfm/commit/c62a8f2177bfa5d04cfb6f6d47d0343b43ad540f))

# [2.66.0](https://github.com/guidefari/gbfm/compare/v2.65.4...v2.66.0) (2026-07-18)


### Bug Fixes

* **email:** tighten input validation ([ca45177](https://github.com/guidefari/gbfm/commit/ca4517793255803ce2b3e6f1c3c54523bfc29db3))
* password reset flow - when passwords arent matching ([89fb3fa](https://github.com/guidefari/gbfm/commit/89fb3fad236a8a95e6e0e8368e6d469460dfd6f3))
* **upload:** partNumber must decode from a string in multipart bodies ([1b19994](https://github.com/guidefari/gbfm/commit/1b199940d8a5a8b8fdf1a5b061c182223b54f8ce)), closes [#187](https://github.com/guidefari/gbfm/issues/187)
* **vps:** add missing packages/api copy to Dockerfile ([9ad0050](https://github.com/guidefari/gbfm/commit/9ad005086b83ddd7eb0358b1db82b021b21f7df0))
* **vps:** address adversarial review findings on music album/track/playlist port ([ff48fa0](https://github.com/guidefari/gbfm/commit/ff48fa045c8aec52c663cb685cceccae6f080a53))
* **vps:** address adversarial review findings on music entity-links port ([4191370](https://github.com/guidefari/gbfm/commit/4191370fa8eb61325a5f45029833f59fb84dba23))
* **vps:** auto-default OTel endpoint to localhost in dev stages ([acbf6ea](https://github.com/guidefari/gbfm/commit/acbf6ea5ee5dab530b7d3851079ce7b560ae931e))
* **vps:** avatar upload 400 from Schema.File multipart mismatch ([6a8d78c](https://github.com/guidefari/gbfm/commit/6a8d78c9fa8feb920cc25e8ed1b51e19c79bdb33))
* **vps:** complete resolve HttpApi cutover (Step 6) ([88921f5](https://github.com/guidefari/gbfm/commit/88921f5cbcb13c55ce1f68b71e047fac8ff3fc09)), closes [#161](https://github.com/guidefari/gbfm/issues/161)
* **vps:** confirmInvite as a real HttpApiEndpoint, not a raw route ([8f326b0](https://github.com/guidefari/gbfm/commit/8f326b0a76398f023a81dc0f1fb8e8706cb0158b))
* **vps:** correct music/albums gap attribution, document middleware ordering ([76704a6](https://github.com/guidefari/gbfm/commit/76704a61c0607309a0e1780b962927e3ad7e9f01)), closes [#189](https://github.com/guidefari/gbfm/issues/189)
* **vps:** remove no-op type assertion flagged by oxlint ([0c402d0](https://github.com/guidefari/gbfm/commit/0c402d02da116e9100d3ebca3880de33a2996017)), closes [#151](https://github.com/guidefari/gbfm/issues/151)
* **vps:** restore email/UUID format validation and await on newsletter unsubscribe ([7157dfe](https://github.com/guidefari/gbfm/commit/7157dfe52c0fef52666b406b1c9d49ec0bdecccc))
* **vps:** restore non-empty-string validation on file-manager fields ([36983bc](https://github.com/guidefari/gbfm/commit/36983bc10cf2a482e3f07f04b0c7c6029a21df1e)), closes [#165](https://github.com/guidefari/gbfm/issues/165) [#166](https://github.com/guidefari/gbfm/issues/166)
* **vps:** restore UUID format validation on favorites audioId/showId ([72d40fc](https://github.com/guidefari/gbfm/commit/72d40fc1c1be51ec09d7ee5103e7216a28cfc473))
* **vps:** restore UUID validation on shows subscribe/unsubscribe id param ([a5c19d0](https://github.com/guidefari/gbfm/commit/a5c19d0fdb5ecabd124bf975a90ee74ec99852a9))
* **vps:** tighten email validation to match zod's z.email() ([bf6b12f](https://github.com/guidefari/gbfm/commit/bf6b12fb61eafbf06a45704a1760f7dbe2229269)), closes [#170](https://github.com/guidefari/gbfm/issues/170)
* **vps:** use real URL parsing for spotify enrich endpoint ([b2dbadb](https://github.com/guidefari/gbfm/commit/b2dbadb981bdebc67f8e1dca61bfa77a1a1fccad))
* **www:** convert Date fields before sending artist metadata updates ([df07f39](https://github.com/guidefari/gbfm/commit/df07f39e7891a21604c49f6d8b4c0c2abd234701)), closes [#184](https://github.com/guidefari/gbfm/issues/184)
* **www:** make 'Resend email' link visibly clickable ([77cdbe1](https://github.com/guidefari/gbfm/commit/77cdbe1d047b1896b859f371003baffa360682b7))
* **www:** wire SocialLinksCard into the actual profile route ([8a7eb11](https://github.com/guidefari/gbfm/commit/8a7eb11d3574952d668c2a5a2251cb4485c94390))


### Features

* **api:** scaffold packages/api with health group contract ([c9b5235](https://github.com/guidefari/gbfm/commit/c9b523532c2cfcbc148ff141ddce9f3650b16f23))
* **email:** port email vertical slice ([36913ab](https://github.com/guidefari/gbfm/commit/36913abcc48ad1a1afd45007e32edb59359e94fa))
* **vps:** add unused Effect toWebHandler + Hono fallback (Step 2a) ([9899df5](https://github.com/guidefari/gbfm/commit/9899df5459f9425345dd122086296e32241d9fd8))
* **vps:** dual-export traces to motel alongside Jaeger ([3a59df8](https://github.com/guidefari/gbfm/commit/3a59df8a3f1b2095804f0cd889cc0cd8b9eb6755))
* **vps:** move CORS/rate-limit/logging/Sentry to Effect global middleware, remove HonoFallback (Step 8) ([cfb13e8](https://github.com/guidefari/gbfm/commit/cfb13e858273506322ad2f1f07b1fabb924b5c4d))
* **vps:** port admin to HttpApiBuilder.group (Step 6) ([b0ec807](https://github.com/guidefari/gbfm/commit/b0ec8072526479ecfdcee2ed47df772a8f8d3175))
* **vps:** port audio group to HttpApiBuilder (step 6) ([0539002](https://github.com/guidefari/gbfm/commit/053900228d4740ce6bb477943a714f7ed04aa223))
* **vps:** port auth middleware to HttpApiMiddleware (Step 3b) ([28ffae7](https://github.com/guidefari/gbfm/commit/28ffae786d9913a21cdb2eabb3e7beb1f81c3171))
* **vps:** port better-auth route onto the Effect router (Step 2c) ([300b58c](https://github.com/guidefari/gbfm/commit/300b58cd705050a79c500aa26d013dcbb41db306))
* **vps:** port favorites to HttpApiBuilder.group (Step 6) ([e82ef4f](https://github.com/guidefari/gbfm/commit/e82ef4f11eb074e03bc230e6bff0c35861c06f34))
* **vps:** port file-manager to HttpApiBuilder.group (Step 6) ([54ba078](https://github.com/guidefari/gbfm/commit/54ba078f551fc81be44da69bc0c70cf9b8e40ef5))
* **vps:** port health to HttpApiBuilder.group (Step 3a) ([bca15fb](https://github.com/guidefari/gbfm/commit/bca15fb29d6dd3d0c8baba61793372d1d078b6b8))
* **vps:** port invite to HttpApiBuilder.group (Step 6) ([65a091a](https://github.com/guidefari/gbfm/commit/65a091a780f409b2a2d9b437fde5e3177abeebba))
* **vps:** port label group to HttpApiBuilder (step 6) ([d438195](https://github.com/guidefari/gbfm/commit/d438195a58eb14dd0be5d8b300b68296d9a26e19))
* **vps:** port music albums/tracks/playlists CRUD to HttpApiBuilder.group (Step 6c) ([40873cf](https://github.com/guidefari/gbfm/commit/40873cf8f60383d144c7f2659968c44b9d031dfa))
* **vps:** port music entity-links/resolve/scrape/pending-queue (Step 6d) ([7d9ad0c](https://github.com/guidefari/gbfm/commit/7d9ad0c68008133d8942550d52351e5b76386db2)), closes [#191](https://github.com/guidefari/gbfm/issues/191)
* **vps:** port music-artists CRUD to HttpApiBuilder.group (Step 4) ([18dafca](https://github.com/guidefari/gbfm/commit/18dafca9e30ba986b9512248584d43997e9e83d9))
* **vps:** port music-reminders to HttpApiBuilder.group (Step 6) ([5cc0c45](https://github.com/guidefari/gbfm/commit/5cc0c45a919d756bb587241109e285b57c8fc349))
* **vps:** port newsletter to HttpApiBuilder.group (Step 6) ([eb1a2a6](https://github.com/guidefari/gbfm/commit/eb1a2a63fc690d0992d3c3abf02e97c83c8dd511))
* **vps:** port post group to HttpApiBuilder (step 6) ([374a480](https://github.com/guidefari/gbfm/commit/374a480416825b70c5c8b9b15610b3ad51364ced))
* **vps:** port profile to HttpApiBuilder.group (Step 6) ([095ab24](https://github.com/guidefari/gbfm/commit/095ab24630d0aea600951669ccba3dacd76de683))
* **vps:** port release group to HttpApiBuilder (step 6) ([1db4dd8](https://github.com/guidefari/gbfm/commit/1db4dd88d5833ea1e6dcad2d179062621e153cdc))
* **vps:** port rss/seo/share routes to plain HttpRouter (Step 7) ([24e57e9](https://github.com/guidefari/gbfm/commit/24e57e9aec3098fe0a8e47e3651eadf2613bbdc2))
* **vps:** port search to HttpApiBuilder.group (Step 6) ([d052ce8](https://github.com/guidefari/gbfm/commit/d052ce82e42ea2129c6db4a3e411a76ce34e604e))
* **vps:** port shows to HttpApiBuilder.group (Step 6) ([b8c5d91](https://github.com/guidefari/gbfm/commit/b8c5d91850c4f722b22db4708461eea4b4cdc586))
* **vps:** port spotify to HttpApiBuilder.group (Step 6) ([34ea0a5](https://github.com/guidefari/gbfm/commit/34ea0a5b4ebc82236a2aca112f46d3dd5b225381)), closes [#165](https://github.com/guidefari/gbfm/issues/165) [#166](https://github.com/guidefari/gbfm/issues/166) [#167](https://github.com/guidefari/gbfm/issues/167)
* **vps:** port upload + upload-multipart to HttpApiBuilder.group (Step 7) ([e3b78d4](https://github.com/guidefari/gbfm/commit/e3b78d4b28ab9045bd9aaa3e2cce3ad49da758b3)), closes [175/#184](https://github.com/guidefari/gbfm/issues/184)
* **vps:** port user group to HttpApiBuilder (step 6) ([0fe5c29](https://github.com/guidefari/gbfm/commit/0fe5c29110c767159f304f5379c55e3c345ed2d7))
* **vps:** swap entry point to Effect toWebHandler (Step 2b) ([5454eea](https://github.com/guidefari/gbfm/commit/5454eea191cb04ead82acd63fd3bc0245fac3791))
* **vps:** wire newsletter group into routes.ts/api.ts, delete old Hono trio ([98f8d47](https://github.com/guidefari/gbfm/commit/98f8d4789761f826dfac8eb2f8ba8c0c5eefc948))
* **vps:** wire OtlpLive into AppLayer to export traces ([732e625](https://github.com/guidefari/gbfm/commit/732e625a7e10803098e6de117b659db2b307d17e))
* **www:** add music reminder deletion ([92d6dbb](https://github.com/guidefari/gbfm/commit/92d6dbbef8db3622205784e4f175e38de0f6f20b))
* **www:** add typed HttpApiClient for the music-artists group ([7aa6dd0](https://github.com/guidefari/gbfm/commit/7aa6dd06b6eaf256ed0c4e249fe03f37542b6de9))
* **www:** improve auth navigation ([4a70fd6](https://github.com/guidefari/gbfm/commit/4a70fd6182e1c7d7a1a5c2454da7b144b43ddd94))
* **www:** replace useAdminArtists' fetcher with the typed client ([90b6622](https://github.com/guidefari/gbfm/commit/90b66227bf09660c01b96c1fe71d970c3478d1a1))
* **www:** self-service social links editor in dashboard ([ccb2a38](https://github.com/guidefari/gbfm/commit/ccb2a386efb4cedc7ad41d2f319cc7c938b83ac5))
* **www:** swap admin-group hooks to typed HttpApiClient (step 6b) ([35bfb5b](https://github.com/guidefari/gbfm/commit/35bfb5bd74060d4ddeda54d13b42c5d3e4a8a531))
* **www:** swap audio-group hooks to typed HttpApiClient (step 6b) ([1779b7f](https://github.com/guidefari/gbfm/commit/1779b7fb145c3841c3845fe2c2e91eb6daf8d78d)), closes [#176](https://github.com/guidefari/gbfm/issues/176) [#177](https://github.com/guidefari/gbfm/issues/177) [#175](https://github.com/guidefari/gbfm/issues/175)
* **www:** swap favorites hooks to typed HttpApiClient (step 6b) ([c98bc94](https://github.com/guidefari/gbfm/commit/c98bc94f9adc12e85fd00a54c0d4619fc87c6fe7))
* **www:** swap label+release hooks to typed HttpApiClient (step 6b) ([150031a](https://github.com/guidefari/gbfm/commit/150031a6546ecfcb675b00241881086b8682b2b5)), closes [171/#172](https://github.com/guidefari/gbfm/issues/172)
* **www:** swap music-artist hooks to typed HttpApiClient (step 6b) ([fd0cd90](https://github.com/guidefari/gbfm/commit/fd0cd90b5636228676672dbb8cdcb280583e5ef6))
* **www:** swap newsletter hooks to typed HttpApiClient (step 6b) ([6843733](https://github.com/guidefari/gbfm/commit/684373300d3c703a9d0ae5ca8d215dc21d9c7281))
* **www:** swap newsletter hooks to typed HttpApiClient (step 6b) ([15b4240](https://github.com/guidefari/gbfm/commit/15b4240d0e6e08413a37664feac55e7c29973c87))
* **www:** swap post-group hooks to typed HttpApiClient (step 6b) ([9e86ca7](https://github.com/guidefari/gbfm/commit/9e86ca76ef9c1142ae247e5a9fda6d48cea6254a)), closes [#176](https://github.com/guidefari/gbfm/issues/176)
* **www:** swap resolve slug consumer to typed Effect client (step 6b) ([d8ebe7d](https://github.com/guidefari/gbfm/commit/d8ebe7d3c5366eff97fd8463050b4e8e5162266a))
* **www:** swap search + profile consumers to typed Effect client (step 6b) ([d1179a8](https://github.com/guidefari/gbfm/commit/d1179a8f16e64bea98772aa68073ead80194cbe7))
* **www:** swap shows-group hooks to typed HttpApiClient (step 6b) ([0c1f9bb](https://github.com/guidefari/gbfm/commit/0c1f9bb1cd31a5fd3342a8af03cc03c86dce1710))
* **www:** swap spotify hooks to typed HttpApiClient (step 6b) ([fb238c7](https://github.com/guidefari/gbfm/commit/fb238c73af8973e6619f251ec58bade83348320a))
* **www:** swap user-group hooks to typed HttpApiClient (step 6b) ([7bce140](https://github.com/guidefari/gbfm/commit/7bce140f8ef30c6da248a19bf021d2f57f750255))
* **www:** toast feedback for dashboard profile settings ([11b8edd](https://github.com/guidefari/gbfm/commit/11b8edd1c0cd32d68a3abc3855222fbe3d237fa6))
* **www:** warn when reset-password link is opened with an active session ([b71cb61](https://github.com/guidefari/gbfm/commit/b71cb61b16c1eb149a062e7a302d4917cec664a9))

## [2.65.4](https://github.com/guidefari/gbfm/compare/v2.65.3...v2.65.4) (2026-07-10)


### Bug Fixes

* console warning ([6fa7324](https://github.com/guidefari/gbfm/commit/6fa7324f234dc501d54d24158eb85b0d0b91f432))
* stylez ([dd4a38f](https://github.com/guidefari/gbfm/commit/dd4a38ff4cfde6136ad7015610c78757be2b2f4f))

## [2.65.3](https://github.com/guidefari/gbfm/compare/v2.65.2...v2.65.3) (2026-07-10)


### Bug Fixes

* **www:** apply 60s cache-control to root path, not just *.html ([437cad4](https://github.com/guidefari/gbfm/commit/437cad401264faafdba892d6051e5769a99b63af))

## [2.65.2](https://github.com/guidefari/gbfm/compare/v2.65.1...v2.65.2) (2026-07-10)


### Performance Improvements

* **www:** cache index.html at edge, lazy-load auth dialogs ([#141](https://github.com/guidefari/gbfm/issues/141)) ([23987c5](https://github.com/guidefari/gbfm/commit/23987c5eb67bb0f1376c3aee32f40285dcf3cf54)), closes [#139](https://github.com/guidefari/gbfm/issues/139)

## [2.65.1](https://github.com/guidefari/gbfm/compare/v2.65.0...v2.65.1) (2026-07-10)


### Performance Improvements

* **www:** cut homepage entry bundle 45%, LCP 1.8s -> 1.0s ([#139](https://github.com/guidefari/gbfm/issues/139)) ([d515b76](https://github.com/guidefari/gbfm/commit/d515b76811f65cb1531186bd4ca1f5ac5ef65acb))

# [2.65.0](https://github.com/guidefari/gbfm/compare/v2.64.0...v2.65.0) (2026-07-10)


### Bug Fixes

* **www:** render artwork in webkit tweet exports ([#137](https://github.com/guidefari/gbfm/issues/137)) ([94ec18b](https://github.com/guidefari/gbfm/commit/94ec18b5c41cbf9ffcacb87dd091d4724f4fde1d))


### Features

* **vps:** add granular OTEL spans to slow trace paths ([#138](https://github.com/guidefari/gbfm/issues/138)) ([382f952](https://github.com/guidefari/gbfm/commit/382f952e96b195a55515ad962b9e6bcb975702c9))

# [2.64.0](https://github.com/guidefari/gbfm/compare/v2.63.0...v2.64.0) (2026-07-06)


### Features

* clickable show hostname ([34649d0](https://github.com/guidefari/gbfm/commit/34649d0a40fea6a60de0fa50ac7855451dfb7ab3))

# [2.63.0](https://github.com/guidefari/gbfm/compare/v2.62.0...v2.63.0) (2026-07-06)


### Bug Fixes

* **www:** collapse tweet actions into kebab menu, fixes mobile crowding ([31db000](https://github.com/guidefari/gbfm/commit/31db000bff05a6452a682e3a791e1ecf32d7e439))


### Features

* **www:** download tweet as png for socials ([a383799](https://github.com/guidefari/gbfm/commit/a38379967279b00aa981cb4849d25bd77f76dadf))
* **www:** qr code to post url in social exports, drop liner notes label ([96db4e1](https://github.com/guidefari/gbfm/commit/96db4e1044604ad52992f81e272f602e2f4b44b4))

# [2.62.0](https://github.com/guidefari/gbfm/compare/v2.61.0...v2.62.0) (2026-07-04)


### Bug Fixes

* **www:** use highlight-foreground on highlight surfaces ([0879df5](https://github.com/guidefari/gbfm/commit/0879df5603e27048c835f6fd67811031dc9b5a48))


### Features

* **theme:** align light/dark palette with blue brand colors ([7a3cb2e](https://github.com/guidefari/gbfm/commit/7a3cb2e4cc1ff79ebcc05b204b9dbc29045a3254)), closes [#e8eef7](https://github.com/guidefari/gbfm/issues/e8eef7)

# [2.61.0](https://github.com/guidefari/gbfm/compare/v2.60.1...v2.61.0) (2026-07-03)


### Features

* **www:** inline streaming-link verify in tweet composer ([#135](https://github.com/guidefari/gbfm/issues/135)) ([4bc4214](https://github.com/guidefari/gbfm/commit/4bc421483b9a1d4b86f4d4c5ae44da761de7ab9a))

## [2.60.1](https://github.com/guidefari/gbfm/compare/v2.60.0...v2.60.1) (2026-07-01)


### Bug Fixes

* **dev:** serve SPA auth pages and trust localhost origin ([#134](https://github.com/guidefari/gbfm/issues/134)) ([e3c32f5](https://github.com/guidefari/gbfm/commit/e3c32f525a20f754c3ed8d828ca96549ba27d129))
* **www:** resolve auth context before guarding routes and preserve redirect target ([#133](https://github.com/guidefari/gbfm/issues/133)) ([0510949](https://github.com/guidefari/gbfm/commit/0510949e819c1d003a20e70264c1e4717194bcbb))

# [2.60.0](https://github.com/guidefari/gbfm/compare/v2.59.0...v2.60.0) (2026-07-01)


### Features

* **www:** shared logger writes to console and Sentry ([#132](https://github.com/guidefari/gbfm/issues/132)) ([908d2bd](https://github.com/guidefari/gbfm/commit/908d2bd1bbd8a87f3f0e9c094d138b3f0a744fb0))

# [2.59.0](https://github.com/guidefari/gbfm/compare/v2.58.0...v2.59.0) (2026-06-21)


### Features

* onCancelUpload ([9ac2b95](https://github.com/guidefari/gbfm/commit/9ac2b95e4bd438d7d3dd19e34ac1e8e423c776bc))

# [2.58.0](https://github.com/guidefari/gbfm/compare/v2.57.4...v2.58.0) (2026-06-21)


### Features

* draft cont ([7aa1111](https://github.com/guidefari/gbfm/commit/7aa11115f39b8c47aaa4d62a96a87c5040545187))

## [2.57.4](https://github.com/guidefari/gbfm/compare/v2.57.3...v2.57.4) (2026-06-21)


### Bug Fixes

* **vps:** lower multipart chunk size under API Gateway 10MiB limit ([#130](https://github.com/guidefari/gbfm/issues/130)) ([fb8a9d6](https://github.com/guidefari/gbfm/commit/fb8a9d6acc1f22abf025320981aa4bbd54cdba6e))

## [2.57.3](https://github.com/guidefari/gbfm/compare/v2.57.2...v2.57.3) (2026-06-21)


### Bug Fixes

* **www:** move Sentry.init to module-level in main.tsx ([#129](https://github.com/guidefari/gbfm/issues/129)) ([b52fbef](https://github.com/guidefari/gbfm/commit/b52fbefd4641282d4c3809f24ee66dc541814b6f))

## [2.57.2](https://github.com/guidefari/gbfm/compare/v2.57.1...v2.57.2) (2026-06-21)


### Bug Fixes

* **www:** send credentials on resumable upload requests ([#128](https://github.com/guidefari/gbfm/issues/128)) ([e452925](https://github.com/guidefari/gbfm/commit/e45292573b96bd89b556494ce79a9bdfe0f04ab4))

## [2.57.1](https://github.com/guidefari/gbfm/compare/v2.57.0...v2.57.1) (2026-06-21)


### Bug Fixes

* circular dep ([4941572](https://github.com/guidefari/gbfm/commit/4941572222c4220a0e90a94bfe5d89d97dd96930))

# [2.57.0](https://github.com/guidefari/gbfm/compare/v2.56.0...v2.57.0) (2026-06-21)


### Features

* **upload:** resumable chunked mix audio upload ([#126](https://github.com/guidefari/gbfm/issues/126)) ([cc25ff3](https://github.com/guidefari/gbfm/commit/cc25ff3fecd01458268360b675d15ded929fe43a))

# [2.56.0](https://github.com/guidefari/gbfm/compare/v2.55.0...v2.56.0) (2026-06-21)


### Features

* images cleanup ([946853a](https://github.com/guidefari/gbfm/commit/946853a64592bbdcf8970fc39a809890eefb6935))

# [2.55.0](https://github.com/guidefari/gbfm/compare/v2.54.0...v2.55.0) (2026-06-16)


### Bug Fixes

* **shows:** align selected show hero with sidebar top ([73b8bcb](https://github.com/guidefari/gbfm/commit/73b8bcb9f767e1eaee6324a7f9d50ed2244cd888))
* **user:** persist admin user image via app-owned profile route ([1581120](https://github.com/guidefari/gbfm/commit/158112064c1c7de79e40a767e016d216bd854194))


### Features

* **admin:** edit mix and post metadata from the content tab ([d5d4162](https://github.com/guidefari/gbfm/commit/d5d41629bdcd03b138ec0513fe258dbe8458b230))
* **mix-upload:** pick audio and artwork from S3 media picker ([a5086c1](https://github.com/guidefari/gbfm/commit/a5086c10d220d1eda482805206a7a41ec864b9d2))
* **shows:** browse mixes inline with a selectable show list ([f75a021](https://github.com/guidefari/gbfm/commit/f75a021939f74c772c2a7dba900632ebaa200e2a))

# [2.54.0](https://github.com/guidefari/gbfm/compare/v2.53.0...v2.54.0) (2026-06-15)


### Bug Fixes

* instrumenting ([fe60644](https://github.com/guidefari/gbfm/commit/fe60644085739a18a0d3f9112d7fdfba91d6c392))
* playlists ui ([9e80211](https://github.com/guidefari/gbfm/commit/9e802119d004550a09499d730242b89064fb6945))


### Features

* **auth:** notify admin on signup ([549de15](https://github.com/guidefari/gbfm/commit/549de155aa11d69d94d31f792c0a8461181cafa9))
* nav ([c595514](https://github.com/guidefari/gbfm/commit/c595514749e4257c6b1b898cd20bdaf12baefe80))
* opt new users into newsletter ([a269f14](https://github.com/guidefari/gbfm/commit/a269f14070213a365717602a28beb51a83df055c))
* search ([9e56af2](https://github.com/guidefari/gbfm/commit/9e56af22cd5527175bfa7cac32a6d065bc930dc1))
* **www:** add dashboard routes ([15ceb13](https://github.com/guidefari/gbfm/commit/15ceb135aa9f1a45eee6dbfaaf01a9a0fd616703))
* **www:** reshape dashboard navigation ([07481b7](https://github.com/guidefari/gbfm/commit/07481b751709b83da118ebc67201e370c3bcfb15))

# [2.53.0](https://github.com/guidefari/gbfm/compare/v2.52.0...v2.53.0) (2026-06-14)


### Bug Fixes

* **theme:** add explicit .ts extensions for Node ESM resolution ([cc0981e](https://github.com/guidefari/gbfm/commit/cc0981e0215386193a0f5197b63090c7053490f7))
* **ui:** use foreground color for form input text and caret ([64c4f25](https://github.com/guidefari/gbfm/commit/64c4f2595160a5fbcd16dc8126eeb5db55089625))
* **www:** use dvh and safe-area-inset for iOS Safari layout ([cc7e9af](https://github.com/guidefari/gbfm/commit/cc7e9af4285f5caf1da96bc09f8dccc83b312428))


### Features

* **gbpm:** add --version and --help flags, suppress ffmpeg stderr on success ([d972718](https://github.com/guidefari/gbfm/commit/d97271843db355732abd17e66e02f890daab2ec2))
* **theme:** add backgroundHex token for theme-color meta tags ([6dfc274](https://github.com/guidefari/gbfm/commit/6dfc27414b463db7d83534f65654fe8745ddef91))
* **tools:** add Rust process-mix CLI ([7ac955d](https://github.com/guidefari/gbfm/commit/7ac955d892544869a1065529168321d2c890bb04))
* **www:** add theme-colors Vite plugin for index.html ([8c2b7a2](https://github.com/guidefari/gbfm/commit/8c2b7a21101cf31cfddcacaaa55f8a5743409bba))
* **www:** admin sidebar nav and dedicated tab routes ([9992e4a](https://github.com/guidefari/gbfm/commit/9992e4a735ee6fc14f29311a25259745ec09efd8))
* **www:** keyboard-navigable floating menu tiles ([7521b60](https://github.com/guidefari/gbfm/commit/7521b60e5ffe27f2e4f2cd2f823c39e074a57f31))
* **www:** sync theme-color meta with ThemeProvider ([20b993f](https://github.com/guidefari/gbfm/commit/20b993f81c8662490dd7ce920cbb3cceb06687a4))

# [2.53.0](https://github.com/guidefari/gbfm/compare/v2.52.0...v2.53.0) (2026-06-14)


### Bug Fixes

* **theme:** add explicit .ts extensions for Node ESM resolution ([cc0981e](https://github.com/guidefari/gbfm/commit/cc0981e0215386193a0f5197b63090c7053490f7))
* **www:** use dvh and safe-area-inset for iOS Safari layout ([cc7e9af](https://github.com/guidefari/gbfm/commit/cc7e9af4285f5caf1da96bc09f8dccc83b312428))


### Features

* **gbpm:** add --version and --help flags, suppress ffmpeg stderr on success ([d972718](https://github.com/guidefari/gbfm/commit/d97271843db355732abd17e66e02f890daab2ec2))
* **theme:** add backgroundHex token for theme-color meta tags ([6dfc274](https://github.com/guidefari/gbfm/commit/6dfc27414b463db7d83534f65654fe8745ddef91))
* **tools:** add Rust process-mix CLI ([7ac955d](https://github.com/guidefari/gbfm/commit/7ac955d892544869a1065529168321d2c890bb04))
* **www:** add theme-colors Vite plugin for index.html ([8c2b7a2](https://github.com/guidefari/gbfm/commit/8c2b7a21101cf31cfddcacaaa55f8a5743409bba))
* **www:** sync theme-color meta with ThemeProvider ([20b993f](https://github.com/guidefari/gbfm/commit/20b993f81c8662490dd7ce920cbb3cceb06687a4))

# [2.53.0](https://github.com/guidefari/gbfm/compare/v2.52.0...v2.53.0) (2026-06-14)


### Bug Fixes

* **theme:** add explicit .ts extensions for Node ESM resolution ([cc0981e](https://github.com/guidefari/gbfm/commit/cc0981e0215386193a0f5197b63090c7053490f7))
* **www:** use dvh and safe-area-inset for iOS Safari layout ([cc7e9af](https://github.com/guidefari/gbfm/commit/cc7e9af4285f5caf1da96bc09f8dccc83b312428))


### Features

* **theme:** add backgroundHex token for theme-color meta tags ([6dfc274](https://github.com/guidefari/gbfm/commit/6dfc27414b463db7d83534f65654fe8745ddef91))
* **tools:** add Rust process-mix CLI ([7ac955d](https://github.com/guidefari/gbfm/commit/7ac955d892544869a1065529168321d2c890bb04))
* **www:** add theme-colors Vite plugin for index.html ([8c2b7a2](https://github.com/guidefari/gbfm/commit/8c2b7a21101cf31cfddcacaaa55f8a5743409bba))
* **www:** sync theme-color meta with ThemeProvider ([20b993f](https://github.com/guidefari/gbfm/commit/20b993f81c8662490dd7ce920cbb3cceb06687a4))

# [2.52.0](https://github.com/guidefari/gbfm/compare/v2.51.0...v2.52.0) (2026-06-13)


### Bug Fixes

* **ci:** add vitest include pattern and fix allowedHosts type ([7f9995a](https://github.com/guidefari/gbfm/commit/7f9995a6ec8f3c85a78ff8be5f3f5b0e3f91779d))
* **infra:** clear VITE_VPS_BASE_URL for local dev ([2e62545](https://github.com/guidefari/gbfm/commit/2e6254571782283479083fa6edc5b1c182bd4abb))
* remove reference to missing otel.ts ([65ac2fd](https://github.com/guidefari/gbfm/commit/65ac2fd1bf4552cd54a9fe020335087eed815129))
* **vps:** handle missing SST resources gracefully ([448edb5](https://github.com/guidefari/gbfm/commit/448edb5e5548b82d0bc7b25838f534ae3e9fc3cc))


### Features

* **www:** proxy API requests through Vite dev server ([cdff26f](https://github.com/guidefari/gbfm/commit/cdff26fd8568b1195464653c79fec8a9a917332e))

# [2.51.0](https://github.com/guidefari/gbfm/compare/v2.50.4...v2.51.0) (2026-05-31)


### Bug Fixes

* **sentry:** reduce local analytics noise ([613127b](https://github.com/guidefari/gbfm/commit/613127b9c95b88c53ea1a0944e5a3a5eea2fcc73))
* **www:** batch playlist saved-track checks ([499e1c4](https://github.com/guidefari/gbfm/commit/499e1c4f7e3884295804e50aaf7df94ee416f485))


### Features

* **www:** add creator actions to dashboard ([96ac92c](https://github.com/guidefari/gbfm/commit/96ac92c9680e85a679b3d71041f7a75b12f5136c))

## [2.50.4](https://github.com/guidefari/gbfm/compare/v2.50.3...v2.50.4) (2026-05-31)

### Bug Fixes

- duplicate req ([bb1102c](https://github.com/guidefari/gbfm/commit/bb1102ceeaf18367ffc0d22a453046f1214eb5f1))
- **www:** duplicate req cont. ([96cfcd4](https://github.com/guidefari/gbfm/commit/96cfcd44056260cd42a67c7f87d8d9e8058f92ce))

## [2.50.3](https://github.com/guidefari/gbfm/compare/v2.50.2...v2.50.3) (2026-05-26)

### Bug Fixes

- **cors:** add sentry headers ([86ecbf2](https://github.com/guidefari/gbfm/commit/86ecbf2c0abda3d2c5641e30eadf443e6f715b10))

## [2.50.2](https://github.com/guidefari/gbfm/compare/v2.50.1...v2.50.2) (2026-05-26)

### Bug Fixes

- apply biome formatting to pass CI lint check ([#115](https://github.com/guidefari/gbfm/issues/115)) ([f34772a](https://github.com/guidefari/gbfm/commit/f34772a71e7934f26caca6433f9b10ccbebc43b9))

## [2.50.1](https://github.com/guidefari/gbfm/compare/v2.50.0...v2.50.1) (2026-05-25)

### Bug Fixes

- **tweet:** restore titles and shorten slugs ([33e9702](https://github.com/guidefari/gbfm/commit/33e97021995f144932a26fb199144a12c5578a5e))

# [2.50.0](https://github.com/guidefari/gbfm/compare/v2.49.0...v2.50.0) (2026-05-25)

### Bug Fixes

- replaced search.token! with a guarded mutation ([9fcf975](https://github.com/guidefari/gbfm/commit/9fcf9758e19b6feb2f1e9b02ef7a5c17c17759e2))

### Features

- **design:** newsletter page ([64eb243](https://github.com/guidefari/gbfm/commit/64eb24339866103ea67a12c7ffab2ab1689d765e))
- password reset flow ([9d621f3](https://github.com/guidefari/gbfm/commit/9d621f399c1a5d97fb491fdaec11d424edaf4864))

# [2.49.0](https://github.com/guidefari/gbfm/compare/v2.48.0...v2.49.0) (2026-05-24)

### Features

- **admin:** add newsletter subscribers tab ([080c07a](https://github.com/guidefari/gbfm/commit/080c07a07dc3e1802b61d4f2f03f6caf639879fe))
- **email:** add personal newsletter welcome email with reply-to support ([eab6f81](https://github.com/guidefari/gbfm/commit/eab6f8136b3e9240a2e20a341e0c00eb2048f50d))
- **newsletter:** add email-based unsubscribe flow ([b2dd9f3](https://github.com/guidefari/gbfm/commit/b2dd9f3059f31649af4a7272bfcb544a1504c5d7))
- **newsletter:** collect optional name on subscribe ([6a00921](https://github.com/guidefari/gbfm/commit/6a00921a1c23dfcbd254b626a5be70c801b3b493))

# [2.48.0](https://github.com/guidefari/gbfm/compare/v2.47.0...v2.48.0) (2026-05-24)

### Bug Fixes

- **backup:** use direct port 5432, typed errors for email alerts ([9aa97ee](https://github.com/guidefari/gbfm/commit/9aa97ee2700892a83d0e38667902bd624b1f724b))
- dockerfile ([5eb7a3d](https://github.com/guidefari/gbfm/commit/5eb7a3dc9b68f3a76e96c4b2e431fc02a94abab3))
- **docker:** upgrade backup task to postgresql18-client ([a097693](https://github.com/guidefari/gbfm/commit/a097693d25f5c252743790f28ae0b56c91a46c16))
- **vps:** switch sentry tracing to bun preload ([592ff15](https://github.com/guidefari/gbfm/commit/592ff15e896f630f637660cc2a0c2b556960fa72))

### Features

- **backup:** add verify-backup script and dev commands ([87a3c4c](https://github.com/guidefari/gbfm/commit/87a3c4ca9692712825bd9707f695aa28cf33adf0))

# [2.47.0](https://github.com/guidefari/gbfm/compare/v2.46.0...v2.47.0) (2026-05-24)

### Bug Fixes

- **vps-tracing:** add parent span. ([292b700](https://github.com/guidefari/gbfm/commit/292b70073439dde6a24f2ad9b5de456109edb681))

### Features

- **vps-health:** cache responses ([b0e9e0c](https://github.com/guidefari/gbfm/commit/b0e9e0cbc3eac3c1798c95644ee33411e3d7c96b))
- **vps-health:** split live and ready check ([78a2169](https://github.com/guidefari/gbfm/commit/78a21695e2f73b9394e07f0eb81a7527be91c6db))

# [2.46.0](https://github.com/guidefari/gbfm/compare/v2.45.1...v2.46.0) (2026-05-24)

### Bug Fixes

- **ci:** gate prod release on docker build ([f9ced51](https://github.com/guidefari/gbfm/commit/f9ced513a5b39efb7c076edfc0e90c3e55b7370a))

### Features

- **db-backup:** minimal integrity check ([091ce72](https://github.com/guidefari/gbfm/commit/091ce72b2062f1da7064beb7992a181090e8f495))
- expire old backups ([9b87da7](https://github.com/guidefari/gbfm/commit/9b87da76135dda7a7aa531528c64018dc1115cf2))

## [2.45.1](https://github.com/guidefari/gbfm/compare/v2.45.0...v2.45.1) (2026-05-24)

### Bug Fixes

- **ci:** trigger prod deploy explicitly ([58df86e](https://github.com/guidefari/gbfm/commit/58df86e27204b34527024b83c0234183d413b55c))

# [2.45.0](https://github.com/guidefari/gbfm/compare/v2.44.0...v2.45.0) (2026-05-24)

### Bug Fixes

- **email:** theme & layout ([d64f932](https://github.com/guidefari/gbfm/commit/d64f932d46f3b3cceb0a45c9c06cef904b912be5))
- test ([e6c4f31](https://github.com/guidefari/gbfm/commit/e6c4f31dcb1d42b4a3e0df0ec698c94943220f2a))

### Features

- network error ui ([aebb1c5](https://github.com/guidefari/gbfm/commit/aebb1c56d284c59d42d92c4f7b1fff6bacbbfb95))
- newsletter improvements ([93690a1](https://github.com/guidefari/gbfm/commit/93690a1e94faa54a1aab4e2731013250671ca9f7))
- ui ([e180f59](https://github.com/guidefari/gbfm/commit/e180f59a09ad19c42bae734986a30f4668ab5e21))
- **vps:** add admin notifications ([d185f9c](https://github.com/guidefari/gbfm/commit/d185f9cd012d9900ab8b3a264f0f67eae79d41e0))
- **www:** split new content capture flows ([0c6e7b1](https://github.com/guidefari/gbfm/commit/0c6e7b1822f1ec599a16a5b1816e329c3f38e285))

# [2.44.0](https://github.com/guidefari/gbfm/compare/v2.43.0...v2.44.0) (2026-05-21)

### Features

- **ux:** tweets ([565c737](https://github.com/guidefari/gbfm/commit/565c737d37d369c7a37c51078d2d64c4d22169f6))

# [2.43.0](https://github.com/guidefari/gbfm/compare/v2.42.0...v2.43.0) (2026-05-21)

### Bug Fixes

- automatically verify manually added links + TS! ([e879b98](https://github.com/guidefari/gbfm/commit/e879b9897a611e80c3f61a6f8fb36f77438b2690))

### Features

- tweets ([97ca3d6](https://github.com/guidefari/gbfm/commit/97ca3d65fd858f277bf3c90e575b7f4e56057f57))

# [2.42.0](https://github.com/guidefari/gbfm/compare/v2.41.0...v2.42.0) (2026-05-17)

### Bug Fixes

- **admin:** move entity detail route out of music catalog nesting ([21e6f01](https://github.com/guidefari/gbfm/commit/21e6f01302fc4c20b8ba658996a13d3fcd365b17))
- dialog animation ([b7dd375](https://github.com/guidefari/gbfm/commit/b7dd375aef6eefcd0d8b5bc702e1c97bcc9791f6))
- **ui:** make playground themes switchable ([a3de85f](https://github.com/guidefari/gbfm/commit/a3de85f2993ce4755a7235a93c10d58e15953fb0))

### Features

- add stream links to tweet card ([0e4b414](https://github.com/guidefari/gbfm/commit/0e4b4142777afca164f49912cc5a356d585fbcb4))
- **admin:** music entity catalog + edit pages ([669879d](https://github.com/guidefari/gbfm/commit/669879d1770dc2713ec2cd0dda3bf62908e3b9a3))
- **db_schema:** defaultAuditFields ([e2e31a4](https://github.com/guidefari/gbfm/commit/e2e31a455763363dd44c6453ef40df89dd162ee9))
- edit music entity links ([b4a5fe2](https://github.com/guidefari/gbfm/commit/b4a5fe2d89d27afc59f6ac3725a817748c2bdac6))
- tweet edit flow ([67067da](https://github.com/guidefari/gbfm/commit/67067da65199b926e44f64ce13d32ed8cd4163e8))
- **ui:** add internal design system playground ([93acdb6](https://github.com/guidefari/gbfm/commit/93acdb6d3ff8786323b5b11f5f9c3d954a41aa95))
- **ui:** music entity detail/edit components + playground panel ([4b4b2fa](https://github.com/guidefari/gbfm/commit/4b4b2fa9a8992d941810e845a5ad95b1cb2754ac))
- **ui:** replace playground with Ladle ([294b9e9](https://github.com/guidefari/gbfm/commit/294b9e913f50a08cf931b79bac507c6ffc0d746a))
- **vps:** integration test infrastructure + music-entity service split ([561fa9b](https://github.com/guidefari/gbfm/commit/561fa9b1ef4e1654d52fcb47f0551c5c90eab01e))
- **www:** add playlists tab to admin/music ([2b9d495](https://github.com/guidefari/gbfm/commit/2b9d495360482e14c41dbf44b932c5aa2fc6da21))

# [2.41.0](https://github.com/guidefari/gbfm/compare/v2.40.1...v2.41.0) (2026-05-13)

### Features

- **admin:** add frontend error simulator ([654680b](https://github.com/guidefari/gbfm/commit/654680b62cbfdd8c882547f26d8c2f24f7ab8604))
- **www:** report API outages to Sentry ([26ffc2c](https://github.com/guidefari/gbfm/commit/26ffc2cd6308740eb334532560a991bc3a83fbe1))

## [2.40.1](https://github.com/guidefari/gbfm/compare/v2.40.0...v2.40.1) (2026-05-12)

### Bug Fixes

- **vps:** Removed the loopback hostname ([7149bbf](https://github.com/guidefari/gbfm/commit/7149bbf9895dd342d83506602ca228301d01dd03))

# [2.40.0](https://github.com/guidefari/gbfm/compare/v2.39.0...v2.40.0) (2026-05-11)

### Bug Fixes

- formatting ([4031b07](https://github.com/guidefari/gbfm/commit/4031b07fee61bffe8e146bc70c5183d17dcf1a3c))
- **infra:** use 127.0.0.1 instead of localhost in CORS and auth origins ([a9649a4](https://github.com/guidefari/gbfm/commit/a9649a410e233bee6fe27461d07bcd70a72d9b28))
- raycast runtime ([fc92d9a](https://github.com/guidefari/gbfm/commit/fc92d9ad14c616dcd26a5c85a10da19b7c72cec9))

### Features

- **vps:** add playlist import and management endpoints ([c7f0c09](https://github.com/guidefari/gbfm/commit/c7f0c0907838c0390f62fb36b60c55c8ffb8bd86))
- **vps:** expose spotifyUrl on playlist payloads ([535ad31](https://github.com/guidefari/gbfm/commit/535ad310a0c000547662ff5aff664805875544e8))
- **vps:** queue Spotify playlist enrichment ([cea1aad](https://github.com/guidefari/gbfm/commit/cea1aadf0b869a31058295d37634d0bb7b54d771))
- **www,vps:** wire Spotify card into playlists and track curator on imports ([3b396a3](https://github.com/guidefari/gbfm/commit/3b396a32d09dbe4c7f58b8bae0c7d60ccc0c58b7))
- **www:** add dedicated admin playlists page with editor ([c2170a7](https://github.com/guidefari/gbfm/commit/c2170a75928c1ac60e0d6356a4ef23fc5cb83920))
- **www:** add Spotify client ID to environment ([72ef629](https://github.com/guidefari/gbfm/commit/72ef629dbe5f51e618e8375f41b7c618e606f3c4))
- **www:** add Spotify PKCE auth library and connection card ([e450129](https://github.com/guidefari/gbfm/commit/e450129b20b2070f44e6e6998d0d9dfcc7eb30fe))
- **www:** queue playlist imports and sync links ([3e77e5a](https://github.com/guidefari/gbfm/commit/3e77e5a602d36a949a07e8704b29296dbea818b7))
- **www:** spotify playlist integration ([7468bdd](https://github.com/guidefari/gbfm/commit/7468bdd3b54b4ae2120a42a86236a76a3c8f98fa))
- **www:** sync changelog content into app ([8d7df6d](https://github.com/guidefari/gbfm/commit/8d7df6d4c9d65e3f536ece57e8d4d1bd2eff12e0))

# [2.39.0](https://github.com/guidefari/gbfm/compare/v2.38.1...v2.39.0) (2026-05-09)

### Bug Fixes

- **www:** place biome suppression on key prop line ([0943e97](https://github.com/guidefari/gbfm/commit/0943e9794eabe5fc92bf0097a6457af0cffd6459))

### Features

- **www:** add tweets and editorial to nav and command palette ([f56f102](https://github.com/guidefari/gbfm/commit/f56f10223abf928ba48c215cabd6ada738437098))
- **www:** refresh tweet post page ([52dcc2a](https://github.com/guidefari/gbfm/commit/52dcc2abe26fa1fa457d4580e5bdc7682502d5bd))

## [2.38.1](https://github.com/guidefari/gbfm/compare/v2.38.0...v2.38.1) (2026-05-09)

### Bug Fixes

- ts ([67e73a7](https://github.com/guidefari/gbfm/commit/67e73a7fe28b9dd9a8dbf486c3920af3e24d6b38))

# [2.38.0](https://github.com/guidefari/gbfm/compare/v2.37.0...v2.38.0) (2026-05-09)

### Features

- **vps:** unified logger with sentry logs fanout ([767d4c9](https://github.com/guidefari/gbfm/commit/767d4c96e7860392f375f5ef4c2065eec56fed11))

# [2.37.0](https://github.com/guidefari/gbfm/compare/v2.36.0...v2.37.0) (2026-05-09)

### Features

- **db:** extend posts with music entity linking ([95e1ff8](https://github.com/guidefari/gbfm/commit/95e1ff8a504ea54b73fb2554d6cdcd98733f099b))
- **music:** add entity resolver endpoint ([1194f1c](https://github.com/guidefari/gbfm/commit/1194f1c09ae09b41b46bb53363d7b41a8472295a))
- sentry BE ([fed2902](https://github.com/guidefari/gbfm/commit/fed2902738d9efc0e40e2caf4bbd5631ae88a2be))
- **www:** add music capture UI for creating posts from URLs ([0f9d13d](https://github.com/guidefari/gbfm/commit/0f9d13dd6ad1594261f4869f29b3adc2fc0e6a45))

# [2.36.0](https://github.com/guidefari/gbfm/compare/v2.35.0...v2.36.0) (2026-05-09)

### Features

- **QoL:** port check before running server ([2b99d94](https://github.com/guidefari/gbfm/commit/2b99d941a491a2f7e41ea22a6d35161a9951133b))

# [2.35.0](https://github.com/guidefari/gbfm/compare/v2.34.2...v2.35.0) (2026-05-08)

### Bug Fixes

- biome schema ([2971027](https://github.com/guidefari/gbfm/commit/2971027508525b22d4ad422afc268306ac077a46))

### Features

- otel cont ([9583761](https://github.com/guidefari/gbfm/commit/9583761463353896025d29d74afabcba15773c7e))

## [2.34.2](https://github.com/guidefari/gbfm/compare/v2.34.1...v2.34.2) (2026-04-28)

### Bug Fixes

- tracklist item highlight ([6c3900b](https://github.com/guidefari/gbfm/commit/6c3900b52bb5645a8e2fecfd65614a5b87caf83c))

## [2.34.1](https://github.com/guidefari/gbfm/compare/v2.34.0...v2.34.1) (2026-04-28)

### Bug Fixes

- **e2e:** theme-toggle session ([44415ff](https://github.com/guidefari/gbfm/commit/44415ff90fc05bc31c9a26be686a4d481a5cfc4a))

# [2.34.0](https://github.com/guidefari/gbfm/compare/v2.33.0...v2.34.0) (2026-04-28)

### Features

- deps ([9d5ef4f](https://github.com/guidefari/gbfm/commit/9d5ef4fecbd13112d2e6472232512815e75652f6))
- tsgo brrrr🚀 ([ada8353](https://github.com/guidefari/gbfm/commit/ada835339f6df3082b6638043439873976fd2e43))

# [2.33.0](https://github.com/guidefari/gbfm/compare/v2.32.0...v2.33.0) (2026-04-28)

### Features

- tailwind upgrade ([f008e8b](https://github.com/guidefari/gbfm/commit/f008e8b0d0b140a789cab40da0aea7d42ae29d17))

# [2.32.0](https://github.com/guidefari/gbfm/compare/v2.31.0...v2.32.0) (2026-04-28)

### Bug Fixes

- dockerfile ([f92358e](https://github.com/guidefari/gbfm/commit/f92358e023576120e43983d51a4529fd331d7222))
- **www:** disable autocap on auth inputs, polish welcome modal mobile ([5d19903](https://github.com/guidefari/gbfm/commit/5d19903042ae71b13d84961a904a212895ec4f3d))
- **www:** make reminder date picker accessible ([d1e06e0](https://github.com/guidefari/gbfm/commit/d1e06e034140e4ed73561c1ca3c30ba7a61d7504))
- **www:** prevent mobile auth horizontal scroll ([91cdf3f](https://github.com/guidefari/gbfm/commit/91cdf3ff47299d29d1d5eabf2d51bca33e6a01c6))
- **www:** reminders datetime picker not opening on desktop ([c6e975d](https://github.com/guidefari/gbfm/commit/c6e975d9f5e81efeb77ff8cd657215d34cab2afd))
- **www:** responsive dashboard layout on mobile ([9ecb59a](https://github.com/guidefari/gbfm/commit/9ecb59aaa4ca3498b8a78b1e4bac5ecac1aaf81c))

### Features

- reminder form improvements ([dc361f0](https://github.com/guidefari/gbfm/commit/dc361f03580e881d2a193c37c05753f09de1d6a3))
- ui ([bb1342c](https://github.com/guidefari/gbfm/commit/bb1342c30b1accb412557a471b96dbf1acb6c3b5))
- **www:** add appearance settings ([4c24b34](https://github.com/guidefari/gbfm/commit/4c24b340040bd8ebe94c71f6e0b92124368b67c8))
- **www:** add reminders to floating nav, restructure dashboard entry points ([4b8f083](https://github.com/guidefari/gbfm/commit/4b8f083426878c3075c6c78573d6139baf8ddea6))

# [2.31.0](https://github.com/guidefari/gbfm/compare/v2.30.0...v2.31.0) (2026-04-27)

### Bug Fixes

- **cmd:** keep keyboard-selected items in view ([d12293a](https://github.com/guidefari/gbfm/commit/d12293ab6282682a7196824081f66221046ee35a))
- **cmd:** polish keyboard handling and footer ([421b54b](https://github.com/guidefari/gbfm/commit/421b54b1654dbecfb74c9073bd73845666232e11))
- tsconfig ([a4c83d3](https://github.com/guidefari/gbfm/commit/a4c83d39ea4a8b52275e41b2eb584cbe0eadaf69))
- verification email ([aea5dd0](https://github.com/guidefari/gbfm/commit/aea5dd032a2f0cb4aa06f9c55a99facc57d2d4de))

### Features

- **auth:** live username availability check on sign-up ([9ade9d2](https://github.com/guidefari/gbfm/commit/9ade9d2fea2007f51ec720a233f8043da956aa2e))
- **auth:** signup ux groundwork ([fec619f](https://github.com/guidefari/gbfm/commit/fec619f1bdd096abb55c2272ef70764f0d2d5e0d))
- **auth:** verify-email banner, signup success state, terms/privacy ([957910e](https://github.com/guidefari/gbfm/commit/957910ea00129a1faf65454364afbbd1757abfb9))
- forgot password ux ([446fc59](https://github.com/guidefari/gbfm/commit/446fc59f70552238ec8c5589b4d668545eff5709))

# [2.30.0](https://github.com/guidefari/gbfm/compare/v2.29.0...v2.30.0) (2026-04-17)

### Bug Fixes

- button styles ([3f35ed6](https://github.com/guidefari/gbfm/commit/3f35ed66eb16040346fa66557f39ed8fed1018b4))

### Features

- **admin:** add overview dashboard ([f127625](https://github.com/guidefari/gbfm/commit/f1276251453b0ba1fe5b70ef6ed5489feee1d6c9))
- invite charlie ([7c3d166](https://github.com/guidefari/gbfm/commit/7c3d1669f8e8a1a14879ad387b68bdfbb717363b))
- list djs ([db2adbb](https://github.com/guidefari/gbfm/commit/db2adbbcc6727ec611b10b8dcfddc544853d56b3))
- ui ([e62a5f8](https://github.com/guidefari/gbfm/commit/e62a5f8fd0c26c99ffc6bec46dfc3fe8aa2c9b63))

# [2.29.0](https://github.com/guidefari/gbfm/compare/v2.28.0...v2.29.0) (2026-03-18)

### Features

- add auth docs to scalar ([e2fa6ea](https://github.com/guidefari/gbfm/commit/e2fa6ea2350a148e2a59c98aee771b428978025f))
- auto-create and link artists during scrape with idempotency ([24206ad](https://github.com/guidefari/gbfm/commit/24206ad44c2d071781d491b39637a45a952aa704))
- **music:** complete platform-agnostic music metadata system ([cb6bc79](https://github.com/guidefari/gbfm/commit/cb6bc791128100da75169ba64e56d980bb14e981))
- platform-agnostic music metadata system ([8f11e70](https://github.com/guidefari/gbfm/commit/8f11e703a69e4e57309468c66cf22dcc7cf5c500))
- remove entityId from scrape endpoint ([cf1b58e](https://github.com/guidefari/gbfm/commit/cf1b58e99871301cbb51392dfb34f2b6b3b71fb7))

# [2.28.0](https://github.com/guidefari/gbfm/compare/v2.27.3...v2.28.0) (2026-03-15)

### Features

- update MixListItem ([d17d4c5](https://github.com/guidefari/gbfm/commit/d17d4c5ba05018765c3af172a7334f509cf2a69c))

## [2.27.3](https://github.com/guidefari/gbfm/compare/v2.27.2...v2.27.3) (2026-03-11)

### Bug Fixes

- **force trigger ci👀:** document ssl redirect loop ([e06f186](https://github.com/guidefari/gbfm/commit/e06f18686eb196f4df421fa4780b334a5d912a44))

## [2.27.2](https://github.com/guidefari/gbfm/compare/v2.27.1...v2.27.2) (2026-03-11)

### Bug Fixes

- backup task dockerfile ([f35f6ba](https://github.com/guidefari/gbfm/commit/f35f6ba08d3823fa487b94db792db1172f42cafe))

## [2.27.1](https://github.com/guidefari/gbfm/compare/v2.27.0...v2.27.1) (2026-03-11)

### Bug Fixes

- biome errors ([903dbfe](https://github.com/guidefari/gbfm/commit/903dbfe62ba7fe1b9c9fd9261b97ce4dbee8d438))
- vps Dockerfile ([d2e6d29](https://github.com/guidefari/gbfm/commit/d2e6d29459a2ad960d5dd1f9b7772fba8841d0c0))

# [2.27.0](https://github.com/guidefari/gbfm/compare/v2.26.1...v2.27.0) (2026-03-07)

### Features

- **seo:** fix sitemap routing, add posts, and add JSON-LD structured data ([2e68fb0](https://github.com/guidefari/gbfm/commit/2e68fb09bfd130ceaecd5b3c45e3e83041aba485))
- **seo:** route sitemap dynamic entries through VPS /s/ pre-render routes ([5410220](https://github.com/guidefari/gbfm/commit/5410220edee8956d1eff0c6932b4afea9fb43999))

## [2.26.1](https://github.com/guidefari/gbfm/compare/v2.26.0...v2.26.1) (2026-03-07)

### Bug Fixes

- play tracking ([5729456](https://github.com/guidefari/gbfm/commit/57294565ff8ba0d06d3630375de995804b8c9d86))

# [2.26.0](https://github.com/guidefari/gbfm/compare/v2.25.0...v2.26.0) (2026-03-06)

### Features

- consolidate shows page ([022042e](https://github.com/guidefari/gbfm/commit/022042eae1d67101cd2b2100df859dac97a03ff9))
- desktop sidenav enhancements ([e7c21bf](https://github.com/guidefari/gbfm/commit/e7c21bf4517e84179353fda38ab7123e6e5446e7))

# [2.25.0](https://github.com/guidefari/gbfm/compare/v2.24.2...v2.25.0) (2026-03-01)

### Features

- **core:** add mix processing module with Effect-based job queue ([7958b38](https://github.com/guidefari/gbfm/commit/7958b38cd23414be587ff712bf0dc72e3dd1c654))
- **raycast:** add process-mix command with async job polling ([f07aaf4](https://github.com/guidefari/gbfm/commit/f07aaf4e5b1c2118a6e9de50b026502b12678c49))
- **vps:** add async mix processing endpoints with job status tracking ([4cc4b4f](https://github.com/guidefari/gbfm/commit/4cc4b4f50ac5ebd0fa2a5a6e0c9b0811b09fd5de))

## [2.24.2](https://github.com/guidefari/gbfm/compare/v2.24.1...v2.24.2) (2026-02-20)

### Bug Fixes

- social icons ([3a98313](https://github.com/guidefari/gbfm/commit/3a98313e73c9c58b9317020ce80317a67345ba33))

## [2.24.1](https://github.com/guidefari/gbfm/compare/v2.24.0...v2.24.1) (2026-02-20)

### Bug Fixes

- **ci:** format ([0686c45](https://github.com/guidefari/gbfm/commit/0686c457b941750e063ba78a648de6be7e1ceffc))

# [2.24.0](https://github.com/guidefari/gbfm/compare/v2.23.0...v2.24.0) (2026-02-20)

### Features

- **design:** init design system ([6ccf038](https://github.com/guidefari/gbfm/commit/6ccf03828cbff262bf5124df4f3cc0206bbb4025))
- **design:** profile page ([1e2f19a](https://github.com/guidefari/gbfm/commit/1e2f19ae5195aa2247829e0252ea32edeb651d4b))
- email logs tab for admin ([3672388](https://github.com/guidefari/gbfm/commit/367238832e34987107d6357b5d9b0154c4bc8bfb))
- **www:** social links on profile ([43b2049](https://github.com/guidefari/gbfm/commit/43b20494c20be32ba6de88f63e4f575790b009b0))

# [2.23.0](https://github.com/guidefari/gbfm/compare/v2.22.1...v2.23.0) (2026-02-18)

### Bug Fixes

- emails ([dc77703](https://github.com/guidefari/gbfm/commit/dc777032c382e5a72e5a8d0bf282269083da5c60))
- sort imports to pass Biome CI checks ([#79](https://github.com/guidefari/gbfm/issues/79)) ([42555d2](https://github.com/guidefari/gbfm/commit/42555d2d5478c227404e93d06e1f5155364cb1c7))

### Features

- invite user flow ([6d24f3d](https://github.com/guidefari/gbfm/commit/6d24f3d71be00b27b438d7c03eb9c909c624370b))

## [2.22.1](https://github.com/guidefari/gbfm/compare/v2.22.0...v2.22.1) (2026-02-17)

### Bug Fixes

- **db:** allow user deletion by updating user FKs to cascade/set null ([af442c7](https://github.com/guidefari/gbfm/commit/af442c7b2e81436fc0b8ff461ce02929ad2e86a0))

# [2.22.0](https://github.com/guidefari/gbfm/compare/v2.21.1...v2.22.0) (2026-02-17)

### Features

- remove publications ([a95683e](https://github.com/guidefari/gbfm/commit/a95683e9e95780157d455c7bd37981170f463be6))

## [2.21.1](https://github.com/guidefari/gbfm/compare/v2.21.0...v2.21.1) (2026-02-16)

### Bug Fixes

- **www:** sync resolve with profile ([f84477b](https://github.com/guidefari/gbfm/commit/f84477bb7e44409a0bc887f13c053cc1b879e6f4))

# [2.21.0](https://github.com/guidefari/gbfm/compare/v2.20.0...v2.21.0) (2026-02-16)

### Features

- clickable link to post author ([dfa680c](https://github.com/guidefari/gbfm/commit/dfa680cabec45140d89b78ebd12596bad1e49ee0))
- restyle mix list item ([9b96ef1](https://github.com/guidefari/gbfm/commit/9b96ef1dc0d3c9f9f742bf86062daff900807ad0))
- **www:** styling (dispatch and profile) ([88e4b12](https://github.com/guidefari/gbfm/commit/88e4b1225102f9dcd69ab41f7094fc34fd36f258))

# [2.20.0](https://github.com/guidefari/gbfm/compare/v2.19.0...v2.20.0) (2026-02-15)

### Features

- create/update post ([84cc06e](https://github.com/guidefari/gbfm/commit/84cc06e6d0b9086cdf50415eca774689c48383aa))

# [2.19.0](https://github.com/guidefari/gbfm/compare/v2.18.0...v2.19.0) (2026-02-13)

### Bug Fixes

- run precommit ([48cd614](https://github.com/guidefari/gbfm/commit/48cd614ff493778051d47a4bc2f5ec0d065f3cbe))
- **www:** extract MixListItem component and fix mobile overflow ([227e3f4](https://github.com/guidefari/gbfm/commit/227e3f479f5dc3dacffd0ef12021b2960692bc6d))

### Features

- analytics wrapper ([0fe55b8](https://github.com/guidefari/gbfm/commit/0fe55b88ed36ca49dd89402d28fe7ae949c622d7))
- local feature flag ([8b91a16](https://github.com/guidefari/gbfm/commit/8b91a16973921f3bf7574136c5bd38c33e2d33c8))
- **www:** use effect (👀) ([fdef587](https://github.com/guidefari/gbfm/commit/fdef58783bc8e02777a3795a8807326132c001c4))

# [2.18.0](https://github.com/guidefari/gbfm/compare/v2.17.0...v2.18.0) (2026-02-13)

### Bug Fixes

- marquee ([14769c5](https://github.com/guidefari/gbfm/commit/14769c5573be064a9c7db27d3a060e5b79162819))

### Features

- audio player improvements ([b98c9c7](https://github.com/guidefari/gbfm/commit/b98c9c71934c48373cfb04fe392bf06a09887e71))

# [2.17.0](https://github.com/guidefari/gbfm/compare/v2.16.0...v2.17.0) (2026-02-13)

### Bug Fixes

- build ([ba2757a](https://github.com/guidefari/gbfm/commit/ba2757ab31c46269dfb0d41b1f3e612ebcaebfab))

### Features

- **vps:** add post by slug endpoint with MDX compilation ([38c8d56](https://github.com/guidefari/gbfm/commit/38c8d56a47c7db725397850fb8a95644c35dc908))
- **vps:** add post share/redirect handler ([0e4750b](https://github.com/guidefari/gbfm/commit/0e4750b7af88e63db10e8913fda992ed5aaace32))
- **www:** add dispatch and pings post routes with show page improvements ([46b1e55](https://github.com/guidefari/gbfm/commit/46b1e55336df6616f402ef6f5bcab8ac9db8e312))

# [2.16.0](https://github.com/guidefari/gbfm/compare/v2.15.0...v2.16.0) (2026-02-10)

### Features

- posts endpoint ([2b22631](https://github.com/guidefari/gbfm/commit/2b226317a1415f1911ed8dec66405d72cdeca7df))

# [2.15.0](https://github.com/guidefari/gbfm/compare/v2.14.0...v2.15.0) (2026-02-10)

### Features

- favourites and subscribing ([67dcde5](https://github.com/guidefari/gbfm/commit/67dcde5aa05cd7489bbc3ed09d1878d96ae2218e))
- favourites/subscribe triggers modal sign up/login ([ff67687](https://github.com/guidefari/gbfm/commit/ff676870a80b980db57b89da6e499db7c8bae1c6))
- onboarding improvements ([ef1de3f](https://github.com/guidefari/gbfm/commit/ef1de3fcc8d2ed17db9d725197160de83c809d05))

# [2.14.0](https://github.com/guidefari/gbfm/compare/v2.13.3...v2.14.0) (2026-02-04)

### Features

- audio player and profile improvements ([e3c36dd](https://github.com/guidefari/gbfm/commit/e3c36ddb52cc895919e40b4b91405ed630546a96))

## [2.13.3](https://github.com/guidefari/gbfm/compare/v2.13.2...v2.13.3) (2026-02-04)

### Bug Fixes

- clickable username on audio player ([e021dc5](https://github.com/guidefari/gbfm/commit/e021dc55dcab51620644fb958fa0e7d09da86ba3))

## [2.13.2](https://github.com/guidefari/gbfm/compare/v2.13.1...v2.13.2) (2026-02-04)

### Bug Fixes

- remove display_username ([7b9aa9b](https://github.com/guidefari/gbfm/commit/7b9aa9b3f9450b65abf24d62b5382eabaa483d04))

## [2.13.1](https://github.com/guidefari/gbfm/compare/v2.13.0...v2.13.1) (2026-02-03)

### Bug Fixes

- force version bump 😛 ([159e33e](https://github.com/guidefari/gbfm/commit/159e33e68bb7d6b2cf0f90135ae66b0e72a1e0c9))

# [2.13.0](https://github.com/guidefari/gbfm/compare/v2.12.0...v2.13.0) (2026-02-03)

### Bug Fixes

- **www:** address critical production issues ([00a9fda](https://github.com/guidefari/gbfm/commit/00a9fda00b73b354cc4330438b79c98e977e7565))

### Features

- **vps:** add rate limiting to public endpoints ([3b428f0](https://github.com/guidefari/gbfm/commit/3b428f0409d4233d379a52a685ba72470285d8b2))

# [2.12.0](https://github.com/guidefari/gbfm/compare/v2.11.0...v2.12.0) (2026-01-30)

### Features

- add `show` support to favourites ([a658638](https://github.com/guidefari/gbfm/commit/a6586386b75b6c9077fea6756c2bc5bb18aff310))
- Implement a cron job to clean up expired QR PDF files from S3 using a new S3 object listing capability. ([4847842](https://github.com/guidefari/gbfm/commit/4847842bb4232cd234275af010ddff0212e0ebf3))
- qr service ([75b6394](https://github.com/guidefari/gbfm/commit/75b639449011f3c876db05e2815d5f8420b7c5ab))
- restrict QR download functionality to admin and creator roles. ([c84d587](https://github.com/guidefari/gbfm/commit/c84d587f8dcc428c5a0d3d8d1dbf82888c926071))

# [2.11.0](https://github.com/guidefari/gbfm/compare/v2.10.0...v2.11.0) (2026-01-29)

### Features

- mix upload ([db49d8f](https://github.com/guidefari/gbfm/commit/db49d8f12e130f7372de49386170f2048a23025f))

# [2.10.0](https://github.com/guidefari/gbfm/compare/v2.9.0...v2.10.0) (2026-01-28)

### Features

- Enhance admin user editing to include username, display name, profile image, email verification, and real-time username availability checks. ([fd308bd](https://github.com/guidefari/gbfm/commit/fd308bd206ac5322c6f5c89c947cbd32f51d7bcd))

# [2.9.0](https://github.com/guidefari/gbfm/compare/v2.8.0...v2.9.0) (2026-01-28)

### Features

- add user search functionality for admin and implement reserved slug generation and validation ([86676b4](https://github.com/guidefari/gbfm/commit/86676b47771061f716317010ea1d0050e861dff9))
- Implement banner image support for shows and enhance host linking with user profiles. ([33edb38](https://github.com/guidefari/gbfm/commit/33edb38fe4b30f71d782a788faa881c5c80bf058))
- Implement newsletter subscription functionality and add an admin tab for show management. ([834ed96](https://github.com/guidefari/gbfm/commit/834ed96bcded36426254cfc44bf87a8a03a76f43))
- implement slug resolution to user profiles or shows and enhance authentication context attachment. ([196161f](https://github.com/guidefari/gbfm/commit/196161fc9f8995bb8e9ccca622f404923da7e83d))
- Redesign show page to include a new banner, detailed header, and structured content sections. ([d13262d](https://github.com/guidefari/gbfm/commit/d13262dc0c9a600d0fc37f3d679466a5f15a5b53))

# [2.8.0](https://github.com/guidefari/gbfm/compare/v2.7.3...v2.8.0) (2026-01-28)

### Features

- Add 'Radio Shows' navigation, enhance mix details with queueing and creator links, and introduce show skeleton loading. ([eba130d](https://github.com/guidefari/gbfm/commit/eba130dc863cf7e0d5c22d7b28c295719deb75b2))

## [2.7.3](https://github.com/guidefari/gbfm/compare/v2.7.2...v2.7.3) (2026-01-28)

### Bug Fixes

- play mix button ([da3c9a3](https://github.com/guidefari/gbfm/commit/da3c9a3a2bea2a51c481cc5be4efc7c6a9468425))

## [2.7.2](https://github.com/guidefari/gbfm/compare/v2.7.1...v2.7.2) (2026-01-28)

### Bug Fixes

- revert to absolute positioning for music player ([cbbc976](https://github.com/guidefari/gbfm/commit/cbbc9769b60f8021af653e3a64edc2866c179099))

## [2.7.1](https://github.com/guidefari/gbfm/compare/v2.7.0...v2.7.1) (2026-01-28)

### Bug Fixes

- formatting ([b9451e1](https://github.com/guidefari/gbfm/commit/b9451e183334f3acaf77fcd225306657fe05965b))
- mobile responsive mixes page ([d1ae448](https://github.com/guidefari/gbfm/commit/d1ae448c4191e92aab8b5dd5fafb21ff775df32f))

# [2.7.0](https://github.com/guidefari/gbfm/compare/v2.6.0...v2.7.0) (2026-01-27)

### Features

- update audio creatorId ([d7eef10](https://github.com/guidefari/gbfm/commit/d7eef1057198757a4716facd0eeb7b5dcf301f4a))

# [2.6.0](https://github.com/guidefari/gbfm/compare/v2.5.0...v2.6.0) (2026-01-27)

### Features

- Implement user display names and admin user creation/management. ([3ff6b33](https://github.com/guidefari/gbfm/commit/3ff6b3328fc7e79cac402687f8977ee95bb46385))

# [2.5.0](https://github.com/guidefari/gbfm/compare/v2.4.0...v2.5.0) (2026-01-27)

### Features

- observability improvements ([3723b98](https://github.com/guidefari/gbfm/commit/3723b98bb6a8a953e91125fb9667069b51600fb4))

# [2.4.0](https://github.com/guidefari/gbfm/compare/v2.3.0...v2.4.0) (2026-01-27)

### Bug Fixes

- effect devtools packages ([59e317e](https://github.com/guidefari/gbfm/commit/59e317e5e0efaee4ae3e066703e21376fb61d17f))
- effect lsp errors ([8375ab2](https://github.com/guidefari/gbfm/commit/8375ab20f298dfdf8e0b847203801c3c0d85a08f))
- effect type errors ([593c21f](https://github.com/guidefari/gbfm/commit/593c21f9debd2dc0669d8e281216988b415749b0))
- export shows schema ([e720e4a](https://github.com/guidefari/gbfm/commit/e720e4aaede3ae07d29e17bae006e90d9fc9fc1b))
- formatting ([6dfabcf](https://github.com/guidefari/gbfm/commit/6dfabcf3af9c3ef8e42903da642e3d1d6bad8f3f))
- more errors highlighted by effect lsp ([01b7536](https://github.com/guidefari/gbfm/commit/01b7536de89ae39ae07fdb800cd530b25ff5b1e0))

### Features

- dev tools ([dfceb5d](https://github.com/guidefari/gbfm/commit/dfceb5d04457cbdebb7a2ac9f79516c49634ed47))
- effect devtools ([189c9b2](https://github.com/guidefari/gbfm/commit/189c9b2a08ada7545426aca9da9e7afc2f247d67))
- landing page ([a08c37d](https://github.com/guidefari/gbfm/commit/a08c37de7f34d22aa87c1a59e64d03f47222870b))
- memory gauge ([db32940](https://github.com/guidefari/gbfm/commit/db32940d7991d15e275853e7e40611ba78cffbec))
- shows backend ([0436146](https://github.com/guidefari/gbfm/commit/0436146c041ba41e8cd284f9472f5a12006a9fd6))
- spans ([3525b47](https://github.com/guidefari/gbfm/commit/3525b470c1785615258a2c5a9ee62a01a2736e23))
- username and public profile ([dca8d78](https://github.com/guidefari/gbfm/commit/dca8d78c2104611db64177fa0676f6d6b19e6842))
- **wip:** Implement show listing, detail pages, and user subscription management for shows. ([132fabf](https://github.com/guidefari/gbfm/commit/132fabf973b96811baadc3f853725acd691b78a9))

# [2.3.0](https://github.com/guidefari/gbfm/compare/v2.2.1...v2.3.0) (2026-01-24)

### Features

- **backup:** extract LogCapture to shared utilities with idiomatic Effect ([e7507dc](https://github.com/guidefari/gbfm/commit/e7507dc0eff43bffd46351a6fafc164a0272f07c))
- preload track ([95a6d22](https://github.com/guidefari/gbfm/commit/95a6d22d24099fdc754a263ddfd43469036bbbb6))
- remiinders styling ([207ed8d](https://github.com/guidefari/gbfm/commit/207ed8d5f161afd8356428b6fb0ed9b992697962))
- **seo:** add SEO to index pages and create sitemap/robots.txt ([c71ca4c](https://github.com/guidefari/gbfm/commit/c71ca4c39895fc410d204d2b6d1542902a1ac144))
- **seo:** add SEO utilities and metadata to dynamic routes ([ea906c4](https://github.com/guidefari/gbfm/commit/ea906c468271833ee6d3edf010132dc86d74b249))
- settngs and dashboard ([eb7e817](https://github.com/guidefari/gbfm/commit/eb7e8170768823e3e8c9250b046a44e78be4a0f0))
- update mixes layout ([4063e27](https://github.com/guidefari/gbfm/commit/4063e276441247f7b2dc8d6790acc149105d5578))
- updateTagsMutation ([3ef1277](https://github.com/guidefari/gbfm/commit/3ef1277b6be8da6d8d50f9bec3fbcdf6df671416))

## [2.2.1](https://github.com/guidefari/gbfm/compare/v2.2.0...v2.2.1) (2026-01-22)

### Bug Fixes

- only fetch favourites when logged in ([1163f92](https://github.com/guidefari/gbfm/commit/1163f928fd35642a29412e5760619388e03fc63c))

# [2.2.0](https://github.com/guidefari/gbfm/compare/v2.1.0...v2.2.0) (2026-01-22)

### Bug Fixes

- cron job initialisation ([d920a30](https://github.com/guidefari/gbfm/commit/d920a302dfeedbf4b61b037564d97ddd083a7953))
- favouriting tracks ([6e5789c](https://github.com/guidefari/gbfm/commit/6e5789c943bb42c4e3e6fc05d25ca657a4f5486c))
- warning ([2e8ae12](https://github.com/guidefari/gbfm/commit/2e8ae1274891c01e37732855e5611336afeaac91))

### Features

- Add structured Effect logging to services and API handlers, and document implementation progress. ([b0e3740](https://github.com/guidefari/gbfm/commit/b0e3740bbe54f5dc7de7ebce22259a858e18b7bc))
- Implement comprehensive performance monitoring for database queries and HTTP requests with severity-based logging and health checks. ([5cf2da1](https://github.com/guidefari/gbfm/commit/5cf2da1e3e32af3b98583d9bbacc8ec5170a87fd))
- Integrate OpenTelemetry distributed tracing with Effect and add initial service spans. ([47101fb](https://github.com/guidefari/gbfm/commit/47101fb3f5f46e16fd84654085b0efcd5934822b))
- Introduce Effect-based logging middleware and integrate it across the application services. ([27381c1](https://github.com/guidefari/gbfm/commit/27381c14b740db5d526b0af84ae80e18bb5f13f7))

# [2.1.0](https://github.com/guidefari/gbfm/compare/v2.0.2...v2.1.0) (2026-01-18)

### Bug Fixes

- Remove system-wide Pulumi binaries in deploy workflow to prevent conflicts with SST Ion. ([545966c](https://github.com/guidefari/gbfm/commit/545966caa556ce40a306071fc9e8e269b3f81b2b))

### Features

- add Bandcamp URL support to Spotify service ([0a0160f](https://github.com/guidefari/gbfm/commit/0a0160f15bf1c6b37b2bb3d5a874e92e710372fa))
- add HTML fallback parsing for Bandcamp metadata ([f5a1d30](https://github.com/guidefari/gbfm/commit/f5a1d30b13ac893bac0c25c41b576f6ce5e1bdc5))

## [2.0.2](https://github.com/guidefari/gbfm/compare/v2.0.1...v2.0.2) (2026-01-18)

### Bug Fixes

- version bump ([d0cd6c7](https://github.com/guidefari/gbfm/commit/d0cd6c74935e1c456fa62501f99e62b0c359dc0e))

## [2.0.1](https://github.com/guidefari/gbfm/compare/v2.0.0...v2.0.1) (2026-01-18)

### Bug Fixes

- auth client ([b653694](https://github.com/guidefari/gbfm/commit/b653694cd74a7d1fa0c6e0a6467ed0d2377b919d))

# [2.0.0](https://github.com/guidefari/gbfm/compare/v1.10.0...v2.0.0) (2026-01-18)

### Bug Fixes

- update core auth login to use /auth endpoint ([6687db7](https://github.com/guidefari/gbfm/commit/6687db79c7d71b17b63412700e6e3a268b2aa8e4))

### Documentation

- update Effect migration status for Phase 6 content/label handler completion ([040f252](https://github.com/guidefari/gbfm/commit/040f25229d79a00f869cf4dd4bf91ae90dc45655))

### Features

- Add new Effect-based services for labels, audio, music reminders, posts, and releases, and refactor music reminder handlers to use the new service layer. ([09c2d21](https://github.com/guidefari/gbfm/commit/09c2d21952105c97c0512b00e316eabd4ba1a57b))
- complete Phase 5 Effect migration - implement remaining services ([66a0f73](https://github.com/guidefari/gbfm/commit/66a0f73246832b62bf7d84f20881167bbc7ebcf3))
- enhance remaining routes and update migration documentation ([384148d](https://github.com/guidefari/gbfm/commit/384148d30dc6cdd726e74d9262070ff669ff35d4))
- migrate auth handlers to use UserService ([c6cabb7](https://github.com/guidefari/gbfm/commit/c6cabb798019b4ac56ef93441c01b30e71ecde6e))
- migrate auth routes to user routes and update routing ([de02785](https://github.com/guidefari/gbfm/commit/de02785ad5f99a015981bc5ed4c224ec3111f8aa))
- migrate content handlers to use Effect services ([429224f](https://github.com/guidefari/gbfm/commit/429224feaeac464a43eb9931fd8e2fd6a73b8c32))
- migrate processUpload handler to Effect ([8934835](https://github.com/guidefari/gbfm/commit/8934835ed1e51792bb32cafed57ffbc6b2ff291a))
- migrate release handlers to use ReleaseService ([1eafe08](https://github.com/guidefari/gbfm/commit/1eafe080b78d70600348c98986865b2521df7d10))
- update runtime to include new Effect services ([df248b5](https://github.com/guidefari/gbfm/commit/df248b51f3cb7ddeaac3caaaf53f42ace7a6ab97))

### BREAKING CHANGES

- Route improvements may affect internal handler structure
- Runtime now includes additional services that may affect service resolution
- Auth API endpoints moved from /auth to /user
- Auth handlers now use Effect-based services instead of direct database operations
- Release handlers now use Effect-based services instead of direct database operations
- Handler migration continues with type-safe service adoption
- Content handlers now use Effect-based services instead of direct database operations
- Services now use Effect-based functional programming

# [1.10.0](https://github.com/guidefari/gbfm/compare/v1.9.0...v1.10.0) (2026-01-17)

### Bug Fixes

- mutex when processing music reminders ([95826e3](https://github.com/guidefari/gbfm/commit/95826e36ca1ad979b4e3fe1ae337f1315e2e9afa))
- ts errors ([c359120](https://github.com/guidefari/gbfm/commit/c3591207e82add33fca2cbace9044069a0f9689f))
- update nvmrc to current lts ([5916ec2](https://github.com/guidefari/gbfm/commit/5916ec22fbe52bd394013945e82342892660dbe8))

### Features

- admin edit mix ([aa8a04f](https://github.com/guidefari/gbfm/commit/aa8a04f8c65b01d1a5764d80585df69bf319d12f))
- create label ([9872c19](https://github.com/guidefari/gbfm/commit/9872c19860e5a0c0ad7fab79f9cc7b182d14b16d))
- dashboard & profile update ([8291c78](https://github.com/guidefari/gbfm/commit/8291c78c4d2a580653736a167fda0fa0b88c7687))
- favourites ([47bffdd](https://github.com/guidefari/gbfm/commit/47bffdd84aaa06dc76269e87151244f75c2bf8c0))
- lazy scroll ([a023518](https://github.com/guidefari/gbfm/commit/a023518221461f3d879928e0fd8295845da5b20d)), closes [#72](https://github.com/guidefari/gbfm/issues/72)
- music reminder ([a3a1bf8](https://github.com/guidefari/gbfm/commit/a3a1bf8eac0d169a5cade584cf08e950c03c9ac0))
- redirect from auth pages if logged in ([4236b2c](https://github.com/guidefari/gbfm/commit/4236b2cc25f8ebf719479e71825efd2b5c36654b))

# [1.9.0](https://github.com/guidefari/gbfm/compare/v1.8.3...v1.9.0) (2025-12-28)

### Features

- better auth roles ([0c971af](https://github.com/guidefari/gbfm/commit/0c971af299a5006257f70e717b0ea9a89bf8967e))

## [1.8.3](https://github.com/guidefari/gbfm/compare/v1.8.2...v1.8.3) (2025-12-28)

### Bug Fixes

- vps cors def ([deb9940](https://github.com/guidefari/gbfm/commit/deb9940f0d478ed4f3c9ee1901b9c4ca970d0d8d))

## [1.8.2](https://github.com/guidefari/gbfm/compare/v1.8.1...v1.8.2) (2025-12-28)

### Bug Fixes

- explicit cors on gateway ([c0d64cb](https://github.com/guidefari/gbfm/commit/c0d64cbe25cbb3e9ad28f25b0ad3efa870f1887b))
- infta files formatting ([8984fd0](https://github.com/guidefari/gbfm/commit/8984fd075b8a358273e7733a66b4e20f9643fe56))

## [1.8.1](https://github.com/guidefari/gbfm/compare/v1.8.0...v1.8.1) (2025-12-28)

### Bug Fixes

- undo gateway cors change ([4fa1ece](https://github.com/guidefari/gbfm/commit/4fa1ece3057f7229f616a1bde862969403fa520c))

# [1.8.0](https://github.com/guidefari/gbfm/compare/v1.7.0...v1.8.0) (2025-12-28)

### Bug Fixes

- format ([0f86753](https://github.com/guidefari/gbfm/commit/0f86753bfe37ac74844719897eebdc8728e9f667))

### Features

- Dynamically configure CORS origin with `FRONTEND_URL` and remove `www` subdomain from production site URL. ([542f72c](https://github.com/guidefari/gbfm/commit/542f72c8d8cbca9584657ad326ed59e40ed43bbc))

# [1.7.0](https://github.com/guidefari/gbfm/compare/v1.6.2...v1.7.0) (2025-12-27)

### Bug Fixes

- cors ([19ac9d6](https://github.com/guidefari/gbfm/commit/19ac9d6e365155420fac995708993b85e8400f82))

### Features

- new mix upload page ([9cf3b54](https://github.com/guidefari/gbfm/commit/9cf3b541e1b2b1337afff97a79b820642a3e8733))
- style www to be a bit more brutalist ([83a3fc4](https://github.com/guidefari/gbfm/commit/83a3fc407d61d816d69358c805db50a9f20fe163))

## [1.6.2](https://github.com/guidefari/gbfm/compare/v1.6.1...v1.6.2) (2025-12-27)

### Bug Fixes

- better auth cors ([bc4503b](https://github.com/guidefari/gbfm/commit/bc4503b1d95e570525f043ecbcb6a77d5efe102f))

## [1.6.1](https://github.com/guidefari/gbfm/compare/v1.6.0...v1.6.1) (2025-12-27)

### Bug Fixes

- better-auth cors ([33db4bd](https://github.com/guidefari/gbfm/commit/33db4bd3f6f4db5049dd47cf1125ed446f6d6f77))

# [1.6.0](https://github.com/guidefari/gbfm/compare/v1.5.0...v1.6.0) (2025-12-27)

### Bug Fixes

- formating ([00ce618](https://github.com/guidefari/gbfm/commit/00ce61850cca4cd263e9696fd298b0840aa349a4))

### Features

- fix player layout on mixes page ([1ffe28f](https://github.com/guidefari/gbfm/commit/1ffe28f6641024159ad8b78db4d17cd6903ba216))

# [1.5.0](https://github.com/guidefari/gbfm/compare/v1.4.0...v1.5.0) (2025-12-27)

### Features

- layout ([835ab9b](https://github.com/guidefari/gbfm/commit/835ab9b4285a2e654ec7e2baa89a10e9f1c7e5ff))
- nav ([#74](https://github.com/guidefari/gbfm/issues/74)) ([baa5421](https://github.com/guidefari/gbfm/commit/baa5421a6d70951b7ecc21505fd3f7390e459627))

# [1.4.0](https://github.com/guidefari/gbfm/compare/v1.3.0...v1.4.0) (2025-12-27)

### Features

- emanual version bump ([5f32431](https://github.com/guidefari/gbfm/commit/5f324311c18b1651861eb0b36e3c2976d573e2f4))

# [1.3.0](https://github.com/guidefari/gbfm/compare/v1.2.0...v1.3.0) (2025-12-27)

### Features

- better auth migration ([0ad61fc](https://github.com/guidefari/gbfm/commit/0ad61fc595dc80b66f9234997d7a445072d4bef0))

# [1.2.0](https://github.com/guidefari/gbfm/compare/v1.1.2...v1.2.0) (2025-12-14)

### Bug Fixes

- remove any ([0e49ef0](https://github.com/guidefari/gbfm/commit/0e49ef03da9b407a7519a50e5f5c9881df8c77e4))

### Features

- audio player wip ([e1c8bab](https://github.com/guidefari/gbfm/commit/e1c8bab50d3b0ca0b7c986fe6b49ed5966b60a20))
- remove shuffle and repeat ([69be785](https://github.com/guidefari/gbfm/commit/69be7851a3e99cf24f170ca6cd3cd958ae12960e))
- render markdown ([c24b019](https://github.com/guidefari/gbfm/commit/c24b01942104aca80db8427b289b0d262c42243a))
- seed rbac ([e2f4a99](https://github.com/guidefari/gbfm/commit/e2f4a99d62f2734520215f21c8d464ef390fac4a))

## [1.1.2](https://github.com/guidefari/gbfm/compare/v1.1.1...v1.1.2) (2025-12-06)

### Bug Fixes

- layer merging ([a1c2f52](https://github.com/guidefari/gbfm/commit/a1c2f52238f9b735ff64c48a2aa61364044795ad))
- queue on full screen audio player ([12e26c8](https://github.com/guidefari/gbfm/commit/12e26c806f236ba4a8dcf2ad457ae34f30b11cb2))

## [1.1.1](https://github.com/guidefari/gbfm/compare/v1.1.0...v1.1.1) (2025-11-23)

### Bug Fixes

- share url ([764ee25](https://github.com/guidefari/gbfm/commit/764ee25bf6ce4be4dcc75a4562d2289231ddcefd))

# [1.1.0](https://github.com/guidefari/gbfm/compare/v1.0.0...v1.1.0) (2025-11-23)

### Features

- Add Open Graph meta tags for link sharing ([#70](https://github.com/guidefari/gbfm/issues/70)) ([9161d49](https://github.com/guidefari/gbfm/commit/9161d490cb1d9329538978b81cee51ccc217d23f))

# [1.0.0](https://github.com/guidefari/gbfm/compare/v0.36.1...v1.0.0) (2025-11-23)

- Add default pagination to VPS GET endpoints ([#68](https://github.com/guidefari/gbfm/issues/68)) ([77fa9d6](https://github.com/guidefari/gbfm/commit/77fa9d6b0caf963465a2ef00d81963a5621e7fde))

### BREAKING CHANGES

- Response format changed from arrays to paginated objects

- chore: Remove migration 0008 for regeneration

Removed migration 0008_next_echo.sql to regenerate it cleanly.
This ensures the migration is properly generated from the current schema state after rebasing with prod.

- fix: Handle count query result properly and fix TypeScript errors

* Fix count() result destructuring - handle potentially undefined first element
* Remove unused 'desc' import from publication handlers (orders by name not createdAt)
* Remove unused 'and' import from label handlers
* All pagination queries now properly handle count results with nullish coalescing
* Publications table orders by name instead of non-existent createdAt field
* Pass typecheck and biome checks

- feat: Update UI clients to support pagination

* Updated www app API client (http.ts) to use useInfiniteQuery for paginated endpoints
* Added pagination controls to mixes, tracks, and labels list pages
* Added "Load More" functionality to label detail page releases
* Updated Raycast extension to automatically load all pages on mount
* All clients now support the new paginated API response format

Changes:

- apps/www/src/lib/http.ts: Converted useAudioByType, useAllLabels, useReleasesByLabel to useInfiniteQuery
- apps/www/src/routes/mixes/index.tsx: Added "Load More" button
- apps/www/src/routes/labels/index.tsx: Added "Load More Labels" button
- apps/www/src/routes/tracks/index.tsx: Added conditional "Load More" buttons for each audio type
- apps/www/src/routes/labels/$labelSlug.tsx: Added "Load More Releases" button
- apps/raycast/src/list-content.tsx: Auto-load all pages of mixes
- apps/raycast/src/edit-mix.tsx: Auto-load all pages of mixes in dropdown
- apps/raycast/src/edit-label.tsx: Auto-load all pages of labels in dropdown

* wip

* format

## [0.36.1](https://github.com/guidefari/gbfm/compare/v0.36.0...v0.36.1) (2025-11-23)

### Bug Fixes

- posthog configs ([25e082b](https://github.com/guidefari/gbfm/commit/25e082b4597d9748c363b4aef635b24bcd1192fa))

# [0.36.0](https://github.com/guidefari/gbfm/compare/v0.35.0...v0.36.0) (2025-11-23)

### Features

- posthog ([7a1e609](https://github.com/guidefari/gbfm/commit/7a1e6090158f8c019afbacf61465550e43281db2))

# [0.35.0](https://github.com/guidefari/gbfm/compare/v0.34.0...v0.35.0) (2025-11-23)

### Features

- Create database backup scripts ([#64](https://github.com/guidefari/gbfm/issues/64)) ([467afaa](https://github.com/guidefari/gbfm/commit/467afaa39904a04cf9e7821a4af9458e1ff5f315))

# [0.34.0](https://github.com/guidefari/gbfm/compare/v0.33.0...v0.34.0) (2025-11-03)

### Features

- send mix notification ([ab55950](https://github.com/guidefari/gbfm/commit/ab55950f4a628f23f9e1a03678c3d36e784cbb3a))

# [0.33.0](https://github.com/guidefari/gbfm/compare/v0.32.0...v0.33.0) (2025-10-26)

### Features

- mix page metadata ([0e2dfea](https://github.com/guidefari/gbfm/commit/0e2dfeaf953b0129a108c312317fec1bb5139259))

# [0.32.0](https://github.com/guidefari/gbfm/compare/v0.31.0...v0.32.0) (2025-10-26)

### Features

- application level query timer ([7349957](https://github.com/guidefari/gbfm/commit/7349957273174e121fa938ea60a5b1ec6650f7af))
- new mix notification email ([6c69212](https://github.com/guidefari/gbfm/commit/6c69212b2ad7e5f2557c68c0ac3d429560b676ea))

# [0.31.0](https://github.com/guidefari/gbfm/compare/v0.30.1...v0.31.0) (2025-10-26)

### Bug Fixes

- ci cache hash file ([6a2f2bb](https://github.com/guidefari/gbfm/commit/6a2f2bb8ae7996fdfc230b0bf6c8e358f65ad5b5))
- date types ([9e44dae](https://github.com/guidefari/gbfm/commit/9e44daeba51249243c54c709cc4e927168abe8c8))
- ts ([32b0ae3](https://github.com/guidefari/gbfm/commit/32b0ae353749052ebd9bf2e64d5a6fbb083c01b0))
- ts ([1a6ae1e](https://github.com/guidefari/gbfm/commit/1a6ae1ed8f4079a6ef9e7eea74f598b274bb33b5))
- ts ([49ca97b](https://github.com/guidefari/gbfm/commit/49ca97bef57dee98f354a5d62a35b0899a43b726))
- ts. ffs. ([ba9239f](https://github.com/guidefari/gbfm/commit/ba9239f82f63e36238696949878cfdc3cacfe878))
- validate limit values for spotify pagination ([0f522e7](https://github.com/guidefari/gbfm/commit/0f522e7dc4bdccf1c64c1de902a2cfb6074c964f))
- **vps:** zod skill issue ([50ed57e](https://github.com/guidefari/gbfm/commit/50ed57ec6a76e188667eaf8c0576e6198b52fecf))

### Features

- fetch client (to be replaced by something that's automated pls) ([98bc9eb](https://github.com/guidefari/gbfm/commit/98bc9eb7fd17c7572b848240b2e09987fcff3848))
- labels admin cms ([d0ce2b8](https://github.com/guidefari/gbfm/commit/d0ce2b860e9b1b8ba5f8bc38b5c1a56dca2843e0))
- quick share ([d06d62b](https://github.com/guidefari/gbfm/commit/d06d62b3040db2a63b243f144ea10088f0ad313d))
- release ([d5fd319](https://github.com/guidefari/gbfm/commit/d5fd319a44a9eeab08926cc8b478e699e835c080))
- wip react-native fps meter ([d9a2be5](https://github.com/guidefari/gbfm/commit/d9a2be543d3944cfc17d2f1c689972b14dbd0b0c))

## [0.30.1](https://github.com/guidefari/gbfm/compare/v0.30.0...v0.30.1) (2025-10-09)

### Bug Fixes

- add links to spotify components ([cf3ef23](https://github.com/guidefari/gbfm/commit/cf3ef2338719f12de83611bc101b02bce8956a07))

# [0.30.0](https://github.com/guidefari/gbfm/compare/v0.29.0...v0.30.0) (2025-10-09)

### Bug Fixes

- bring back spotify ([fca9856](https://github.com/guidefari/gbfm/commit/fca9856efe951b29474b9e5918c96941f01192f3))
- build ([4e45eba](https://github.com/guidefari/gbfm/commit/4e45eba9dee4d68cf84e815bf2612b5bd77df969))

### Features

- labels. lowkey (highkey) wip tho. ([391ab61](https://github.com/guidefari/gbfm/commit/391ab61e216c06c9f327210843ac49c331a2b94b))
- raycast wip ([4ad7007](https://github.com/guidefari/gbfm/commit/4ad7007a7089d1e9a887db759283b8c9edb63188))

# [0.29.0](https://github.com/guidefari/gbfm/compare/v0.28.4...v0.29.0) (2025-10-07)

### Features

- theming updates ([4ff6944](https://github.com/guidefari/gbfm/commit/4ff6944153f98cf8a64665c028fa4e2bb9f7a4d5))

## [0.28.4](https://github.com/guidefari/gbfm/compare/v0.28.3...v0.28.4) (2025-10-06)

### Bug Fixes

- dockerfile ([96b8a37](https://github.com/guidefari/gbfm/commit/96b8a3762a47e001a7ab79197c5614b6e5ada576))

## [0.28.3](https://github.com/guidefari/gbfm/compare/v0.28.2...v0.28.3) (2025-10-06)

### Bug Fixes

- remove redundant typecheck ([55e081c](https://github.com/guidefari/gbfm/commit/55e081c05eb1239a3cc86ee070383c604c046f33))

## [0.28.2](https://github.com/guidefari/gbfm/compare/v0.28.1...v0.28.2) (2025-10-06)

### Bug Fixes

- dockerfile ([c084277](https://github.com/guidefari/gbfm/commit/c084277b96d9d2eddbb2e136ada4df15023bcebf))

## [0.28.1](https://github.com/guidefari/gbfm/compare/v0.28.0...v0.28.1) (2025-10-06)

### Bug Fixes

- dockerfile ([40f77be](https://github.com/guidefari/gbfm/commit/40f77be5f26d2fb05b0f27ab5f73a067cdf6fd63))

# [0.28.0](https://github.com/guidefari/gbfm/compare/v0.27.1...v0.28.0) (2025-10-06)

### Bug Fixes

- web build script ([fd6a502](https://github.com/guidefari/gbfm/commit/fd6a502662614b0a823a87bceb71f42ef3f6e459))

### Features

- fe types ([2fb9d01](https://github.com/guidefari/gbfm/commit/2fb9d011c7bd7c81fefb93056e90db094adddc52))

## [0.27.1](https://github.com/guidefari/gbfm/compare/v0.27.0...v0.27.1) (2025-10-06)

### Bug Fixes

- vps type fixes ([23cae93](https://github.com/guidefari/gbfm/commit/23cae932408eab4a138aefc4fa65a003bf49bfe3))

# [0.27.0](https://github.com/guidefari/gbfm/compare/v0.26.0...v0.27.0) (2025-09-28)

### Features

- cms wip ([df8a83e](https://github.com/guidefari/gbfm/commit/df8a83e29d19761ca353a5e411dec65cb9d8743d))

# [0.26.0](https://github.com/guidefari/gbfm/compare/v0.25.1...v0.26.0) (2025-09-24)

### Features

- content endpoints ([4731b9c](https://github.com/guidefari/gbfm/commit/4731b9cd72928ba2b2935cf70da8e34fe77a50f2))

## [0.25.1](https://github.com/guidefari/gbfm/compare/v0.25.0...v0.25.1) (2025-09-14)

### Bug Fixes

- missing secret ([79e047a](https://github.com/guidefari/gbfm/commit/79e047aae66ceb7104068455b409a0158e747f24))

# [0.25.0](https://github.com/guidefari/gbfm/compare/v0.24.0...v0.25.0) (2025-09-14)

### Features

- db migration ([2172a12](https://github.com/guidefari/gbfm/commit/2172a12867fd97962915399eebc9ad666b1dc5f7))
- db migration cont ([7663fdc](https://github.com/guidefari/gbfm/commit/7663fdcbb7979f1e20384bbad1ea65332f05be10))

# [0.24.0](https://github.com/guidefari/gbfm/compare/v0.23.0...v0.24.0) (2025-08-09)

### Features

- audio player + keyboard shortcuts ([5abc7bc](https://github.com/guidefari/gbfm/commit/5abc7bc40accfd25303f2587ebcc5837cf4cf1c1))

# [0.23.0](https://github.com/guidefari/gbfm/compare/v0.22.0...v0.23.0) (2025-08-08)

### Features

- fullscreen audio player ([d8a1fd0](https://github.com/guidefari/gbfm/commit/d8a1fd07a63de1de8e9795dce2adc428f6100363))

# [0.22.0](https://github.com/guidefari/gbfm/compare/v0.21.0...v0.22.0) (2025-08-07)

### Features

- queue ([314b2e6](https://github.com/guidefari/gbfm/commit/314b2e6db9ba4bf7e70d3cd58fa2d5951ba352ec))
- refreshed audio player ([38acf73](https://github.com/guidefari/gbfm/commit/38acf7319a85bea45946ccf3f5622c081dc4eb85))

# [0.21.0](https://github.com/guidefari/gbfm/compare/v0.20.2...v0.21.0) (2025-08-06)

### Features

- upload audio ([8066e35](https://github.com/guidefari/gbfm/commit/8066e35f9f8db0d37debf78e17081b58ab399883))

## [0.20.2](https://github.com/guidefari/gbfm/compare/v0.20.1...v0.20.2) (2025-08-05)

### Bug Fixes

- web build script ([f43c60a](https://github.com/guidefari/gbfm/commit/f43c60a2088f30f543ec6a721c959f5e8abb9643))

## [0.20.1](https://github.com/guidefari/gbfm/compare/v0.20.0...v0.20.1) (2025-08-05)

### Bug Fixes

- deploy script ([4e11b32](https://github.com/guidefari/gbfm/commit/4e11b32d7108aabb898a8c95207336e5aaa9f7a3))

# [0.20.0](https://github.com/guidefari/gbfm/compare/v0.19.1...v0.20.0) (2025-08-05)

### Features

- volume controls ([da32fc0](https://github.com/guidefari/gbfm/commit/da32fc08f5021290f7ab805b89b61f217abf8114))

## [0.19.1](https://github.com/guidefari/gbfm/compare/v0.19.0...v0.19.1) (2025-08-05)

### Bug Fixes

- docker entrypoint ([56d3f2b](https://github.com/guidefari/gbfm/commit/56d3f2ba12c9fe39dd07af1183f1eeaf3e52f2dd))

# [0.19.0](https://github.com/guidefari/gbfm/compare/v0.18.0...v0.19.0) (2025-08-05)

### Bug Fixes

- dockerfile ([2a06d02](https://github.com/guidefari/gbfm/commit/2a06d02842177c9bd6146b1ca4f9f6ce2ff91732))

### Features

- loading skeleton ([b7c548f](https://github.com/guidefari/gbfm/commit/b7c548fa78e61faceba4718e2d723e7d24aaa964))

# [0.18.0](https://github.com/guidefari/gbfm/compare/v0.17.0...v0.18.0) (2025-08-05)

### Features

- audio player improvements ([5577abe](https://github.com/guidefari/gbfm/commit/5577abed16e359f3ebe5e23e50b49cfb731dff8e))

# [0.17.0](https://github.com/guidefari/gbfm/compare/v0.16.0...v0.17.0) (2025-08-03)

### Bug Fixes

- grid on single mix page was wonky ([aeb46e8](https://github.com/guidefari/gbfm/commit/aeb46e847ed298a0fda603f4ff4127d1c2e75ae5))
- remove redundant frontmatter processing ([103b086](https://github.com/guidefari/gbfm/commit/103b0868629a4ec4586fe04e8851f4e2fbff62b7))

### Features

- single mix page ([0d23491](https://github.com/guidefari/gbfm/commit/0d23491731de4a9a25202a807681391d801cb47e))

# [0.16.0](https://github.com/guidefari/gbfm/compare/v0.15.0...v0.16.0) (2025-08-01)

### Features

- commando updates ([0841bd3](https://github.com/guidefari/gbfm/commit/0841bd31e5ae6e6d22412afa4a50ecb992f6ddef))

# [0.15.0](https://github.com/guidefari/gbfm/compare/v0.14.0...v0.15.0) (2025-07-27)

### Features

- dynamic rss ([de26bb6](https://github.com/guidefari/gbfm/commit/de26bb66f19859326992058d2828a997a3804cfc))
- file upload endpoints ([fcc59a6](https://github.com/guidefari/gbfm/commit/fcc59a69921e903c019565ac10a489d825ccbb50))
- upload audio ui ([485cb92](https://github.com/guidefari/gbfm/commit/485cb9240535fbb412d8be9c9f2d524927750c1e))

# [0.14.0](https://github.com/guidefari/gbfm/compare/v0.13.0...v0.14.0) (2025-07-26)

### Features

- remove web workers. ([5689fed](https://github.com/guidefari/gbfm/commit/5689fed7bc25cdd86957ae660aa4c506a8256265))

# [0.13.0](https://github.com/guidefari/gbfm/compare/v0.12.0...v0.13.0) (2025-07-26)

### Features

- update profile ([fad00e6](https://github.com/guidefari/gbfm/commit/fad00e6ccc516793c758d27074edc91540de7f45))

# [0.12.0](https://github.com/guidefari/gbfm/compare/v0.11.0...v0.12.0) (2025-07-26)

### Bug Fixes

- type errors ([88bcac9](https://github.com/guidefari/gbfm/commit/88bcac941e01fb3c2495123a652fe4b2fd9bde8f))

### Features

- auth & profile stuff ([e7e1490](https://github.com/guidefari/gbfm/commit/e7e1490009b66bf7f7d6442229fc61a8eba364d2))

# [0.11.0](https://github.com/guidefari/gbfm/compare/v0.10.4...v0.11.0) (2025-07-26)

### Features

- update mix route ([9acbbc0](https://github.com/guidefari/gbfm/commit/9acbbc0a0562ada6d0147025c18e51d05d6ca677))

## [0.10.4](https://github.com/guidefari/gbfm/compare/v0.10.3...v0.10.4) (2025-07-25)

### Bug Fixes

- add pnpm workspace file to container ([92e5034](https://github.com/guidefari/gbfm/commit/92e503459881f160b2a7b61c67b1a092ab7b45c0))

## [0.10.3](https://github.com/guidefari/gbfm/compare/v0.10.2...v0.10.3) (2025-07-25)

### Bug Fixes

- www build script ([12e2b41](https://github.com/guidefari/gbfm/commit/12e2b41b94417063fdc1957e9b166ecc03acad67))

## [0.10.2](https://github.com/guidefari/gbfm/compare/v0.10.1...v0.10.2) (2025-07-25)

### Bug Fixes

- www build script ([1585e92](https://github.com/guidefari/gbfm/commit/1585e92d07ff427fc48b1a4f3855c3933706f88b))

## [0.10.1](https://github.com/guidefari/gbfm/compare/v0.10.0...v0.10.1) (2025-07-25)

### Bug Fixes

- dockerfile paths ([ac2ce8e](https://github.com/guidefari/gbfm/commit/ac2ce8e608269db90fda3b114b69ae343946a68e))

# [0.10.0](https://github.com/guidefari/gbfm/compare/v0.9.0...v0.10.0) (2025-07-25)

### Features

- content migration scripts ([b5881b2](https://github.com/guidefari/gbfm/commit/b5881b2c6c21f592c6e77c0286567c8df12980f4))

# [0.9.0](https://github.com/guidefari/gbfm/compare/v0.8.0...v0.9.0) (2025-07-25)

### Features

- migrating from mixes schema to generic audio ([c5335f0](https://github.com/guidefari/gbfm/commit/c5335f04fd78b6eddb094851f29bc926a4dfa217))

# [0.8.0](https://github.com/guidefari/gbfm/compare/v0.7.0...v0.8.0) (2025-07-23)

### Features

- release test ([d3fb620](https://github.com/guidefari/gbfm/commit/d3fb6209591b1737cfa2d29278cd551b038b5cee))

# [0.7.0](https://github.com/guidefari/gbfm/compare/v0.6.5...v0.7.0) (2025-07-23)

### Bug Fixes

- update seed scripts ([bfe3835](https://github.com/guidefari/gbfm/commit/bfe38358176fd97b590d966ceec0fc1fa4bce4b8))

### Features

- disable seed endpoint ([5bc992e](https://github.com/guidefari/gbfm/commit/5bc992efb30cd133ab098fb789012c0421f59984))

## [0.6.5](https://github.com/guidefari/gbfm/compare/v0.6.4...v0.6.5) (2025-07-22)

### Bug Fixes

- import path ([0b1b641](https://github.com/guidefari/gbfm/commit/0b1b6413969ea32cefeaa4be901eb6a0d717d485))
- type errors - #blind fix👀 ([0248c02](https://github.com/guidefari/gbfm/commit/0248c02e7a782247b88d15191af1407a659ddcbd))
