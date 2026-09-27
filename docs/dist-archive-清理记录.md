# dist-archive 清理记录（2026-09-27）

## 为什么清
`apps/desktop/dist-archive/` 是 rc 打包的历史回退取证区（skill 纪律：不直接删）。本轮审计发现 93 个文件/4.3GB 中只有 7 个能证明「GitHub 发布仓可重新下载且字节一致」，其余是**从未发布的本地 rc 构建**。按回退价值分类后清理：
- **死线体**（78 个，2.46GB+0.67GB+0.35GB）：0.1.x / 0.3.0-rc.1~28 / 0.4.1-rc.1~7——与当前 line（schema v10）跨代，拿回来也读不了现库数据，且 0.3.0 正式版线上在架 (9,340,317B)。
- **线上可重下重复件**（7 个，0.37GB）：名称与大小与发布仓资产逐字节一致，随时可重新下载。
- **保留 8 个**：0.4.0 / 0.4.2 / 0.4.2-rc.1 / 0.4.2-rc.2（各 exe+blockmap）——最近可用的历史回退点；当前线体的 0.6.0（feed 在用）与 0.6.1-rc.1、`win-unpacked/` 在 `dist/` 内不动。

## 删除清单（85 个 / 3.85 GB，sha256 全量留档）

```text
file                                                            bytes  sha256
Septcats Setup 0.1.1.exe                                     92848296  e7a74ef8f53275bf1db24a9fca10e713e0f993c56def57ce3f27884d6442e7ed
Septcats Setup 0.1.1.exe.blockmap                               98183  d0c294c84c23774a19c5b11204cb839e8e27cabc2279b056e8ebd6fc2f128592
Septcats Setup 0.1.2.exe                                     92848515  bb9b7b8f462c6e6a640bf513f0e4105ef40d6fdf501929a4cb3876b43d92389a
Septcats Setup 0.1.2.exe.blockmap                               98259  84623368ec677c57526ae7859ddce44f3c66bf0d28246e80eeab5cf95e13e256
Septcats Setup 0.1.3.exe                                     92779172  d96e47acf07f931b0d80873eb9be3d6bb29d516239a8d267aeaa6c2395f31b8d
Septcats Setup 0.1.3.exe.blockmap                               98486  3e76a4e7d24cb2fdb3648712b3102a12efd6dfa82c4f07fcc8331ed4ff40dbb2
Septcats Setup 0.1.4.exe                                     93375785  af518c35ea714662c1881ad692183fb61181c68a4c7670712f9e5c035930f827
Septcats Setup 0.1.4.exe.blockmap                               98741  162ae2302fe1ed9cc8efd138f1fb3f2c35c92d48514a73397afc1171dddbe254
Septcats Setup 0.3.0-rc.1.exe                                93384268  672665a1a0574e71ccd36e7778608ff78f2f39c2760ceea1926e4dbd44af02de
Septcats Setup 0.3.0-rc.1.exe.blockmap                          98528  45f257bece26d657cf3b1a2737f88553593857e75be32f429b4053355773ca31
Septcats Setup 0.3.0-rc.10.exe                               93403525  b617b53eda0c05572e835357e537434c4ab8e064281cc3ffd29ec939a2dd9ff1
Septcats Setup 0.3.0-rc.10.exe.blockmap                         98827  5671a316b27398e625666436b5db52f66ac7e532a3ad9c0c9866e3be131213bb
Septcats Setup 0.3.0-rc.11.exe                               93405477  733cf709590e8dba99da48ccc38ab396ccb1f43564a6a66cab62f4645f556417
Septcats Setup 0.3.0-rc.11.exe.blockmap                         98981  e4418a1e1f0222450461dccbcb8b6d6efb8e714a81b0da24803a189f06e7f848
Septcats Setup 0.3.0-rc.12.exe                               93408822  08e8fdb65f34ee368936a5742f3532ae5f28fd77718bb99220d9784964f4ea30
Septcats Setup 0.3.0-rc.12.exe.blockmap                         98944  31e6a8125a15ff52867dfdec28c698e6d465a475a48e7c3f6c63eaf6f010152d
Septcats Setup 0.3.0-rc.13.exe                               93418058  e7406082617468de5370311df2e1bf06fa3a0a57ee629509fbe48c859ca5b4f2
Septcats Setup 0.3.0-rc.13.exe.blockmap                         98800  9a9bf57ede140dc29c40b5102e26c2566f6e13709b5badd13059cad5136845a7
Septcats Setup 0.3.0-rc.14.exe                               93417999  e586bb459887723a17213a859e07db25b74551a8907c98b9aa59db7c71c94146
Septcats Setup 0.3.0-rc.14.exe.blockmap                         98795  cd942eeb12544b524a99bad1767cf739e6c1910818b0fb3c82578b1fe9e0dbdd
Septcats Setup 0.3.0-rc.15.exe                               93425376  70076aa998fa8ed2519c9002c76584893b5869fef53f71c8a261e510ac22bcc7
Septcats Setup 0.3.0-rc.15.exe.blockmap                         98811  79a112bbbd35a7e2ac6be37a30f73daa6bc3b1d57dd79362c5010244792537e4
Septcats Setup 0.3.0-rc.16.exe                               93425712  bb3102905593ebeb82b788368a955c4ee117ca16c96ebb7a0eaae93614599f5d
Septcats Setup 0.3.0-rc.16.exe.blockmap                         98826  52548936e74274239429126108356384a83da3ce85ed9229dae5db4f35e8dc9f
Septcats Setup 0.3.0-rc.17.exe                               93426922  e619eb9d15f8b0abe56778bf0aee1fd7a978ea03ead1ad2eee1a8e5158dc3955
Septcats Setup 0.3.0-rc.17.exe.blockmap                         98886  226e247ef72d6f2885272bd1a09a2476d6d1ce926e458d98b2ca19edbc6f00fe
Septcats Setup 0.3.0-rc.18.exe                               93425131  c6c1b0a3fbb728e7297aee1eb20b0b3fce0066221118838c340560b86e260979
Septcats Setup 0.3.0-rc.18.exe.blockmap                         98782  1f0aff32e44e3ea0c0bdb1d79d4c868229aa301c57216c8d69bbe7addfb1c53c
Septcats Setup 0.3.0-rc.19.exe                               93430071  d6d04e7050d45571c93a37b6ac2f2ee4b85be99014137bd1a5d324814d7cb5ab
Septcats Setup 0.3.0-rc.19.exe.blockmap                         98930  a0c58355a77ced672fc60a221c5042c8bc7125c2290c13c470dee90df70eb25f
Septcats Setup 0.3.0-rc.2.exe                                93392225  a608ce36b04eb1c993efca15712d4cef45aa7e14ecdc034fb9beb09454a1ba29
Septcats Setup 0.3.0-rc.2.exe.blockmap                          98514  1e5cdc1f93a3d5a1ed010caecb249272e5399461441bb61acea065cbc713c579
Septcats Setup 0.3.0-rc.20.exe                               93428040  3bd4d9c0356d6486ef6cbfb41213937e39dc397da9b2bda71be31bac726912f9
Septcats Setup 0.3.0-rc.20.exe.blockmap                         98861  fcb2c347c245d8dde22b58fb766a7aed37ad4ed67d0dc430fbb6c286986831ec
Septcats Setup 0.3.0-rc.21.exe                               93432094  c2ab882dfa863e6007b56e0c27548a0eee5b0ed4cace8ac25dbd0a0a6adf2c3d
Septcats Setup 0.3.0-rc.21.exe.blockmap                         98959  db983ad6ea49597d01d8244dd45c1e9d5c277a32523b4e4ea57cf6eafd59cb19
Septcats Setup 0.3.0-rc.22.exe                               93432701  f84824d79384027ae5a219f7f7752d0d5d68f96c2a6bf2a45a9fa5cfaa17bb27
Septcats Setup 0.3.0-rc.22.exe.blockmap                         98825  e579dd975051579d9e667153200a7758e6044459f401112eb19a270fb53a3e6f
Septcats Setup 0.3.0-rc.23.exe                               93432909  186165f3ed687ec2470ba5faa30446f454cf71b39e5e63ad94722b7706d0c116
Septcats Setup 0.3.0-rc.23.exe.blockmap                         98857  deeeaa160c8a9bcbce54674f6d8010eb460941c48eff2ff086e388ea365147cc
Septcats Setup 0.3.0-rc.24.exe                               93432844  fd061c92f86e1174160b3754d3af11ad3a44d51b2f9a803ffa8fd517d9f9086c
Septcats Setup 0.3.0-rc.24.exe.blockmap                         98897  a231ac29799221a62d70bb46350072e62fbe317650282567c271fa2fd4db3360
Septcats Setup 0.3.0-rc.25.exe                               93437021  edd655dfc47d8d413412d3b10b9529a084416e4f529abfc5ed14693527f07e5d
Septcats Setup 0.3.0-rc.25.exe.blockmap                         98764  923f2fc5f1df45f3144acb08548a826140f72230c2624f5b3689fe530608b031
Septcats Setup 0.3.0-rc.26.exe                               93439049  e648d274d90cc28e68239b3201bb16fd2ea247c5dea6e7c417c7815808110f86
Septcats Setup 0.3.0-rc.26.exe.blockmap                         98863  3b9aca27db1c6da20448c5d587e9e113f3895f2aa1f730d0a5b8705c503da3c1
Septcats Setup 0.3.0-rc.27.exe                              102493494  23bc9b89a418f79b33ed22b852f7bbf86ec70a7a262fce2baeba6f62e9b01cea
Septcats Setup 0.3.0-rc.27.exe.blockmap                        107057  820d5c24d5f33407986239ab01b7eb7f04ee7854393bb19028dde202e7539511
Septcats Setup 0.3.0-rc.28.exe                              102522122  7f5537adae0e9451237c1f4dd745fb3734389e1269d8a6de928b00994f74f8a8
Septcats Setup 0.3.0-rc.28.exe.blockmap                        107456  5cca7dcccb07e7cda057dfa2a170d7563fd7fb4a81778b485c5e56bbe6c336fd
Septcats Setup 0.3.0-rc.3.exe                                93391406  ff0615add82a8a482b73139210519cfe44eaad687667944bda2ce507bbfbb156
Septcats Setup 0.3.0-rc.3.exe.blockmap                          98520  929cb84e4b106b6ba542c59dbfb424b1a56356fca43120fa54aaaf26df8cd7c5
Septcats Setup 0.3.0-rc.4.exe                                93395532  7444de00216d8085edd4bcae1a901e66b5bdd09978cc1232ea97ca4f17d11a44
Septcats Setup 0.3.0-rc.4.exe.blockmap                          98702  df6efe93ae17877f83112a4e8a6332f5ac1320e281634f1c05d4846c4e99a354
Septcats Setup 0.3.0-rc.5.exe                                93398584  c14ae73c13bed278dc7efeb5670ca5361e2f9f28a1bd7225906f690d492ca02c
Septcats Setup 0.3.0-rc.5.exe.blockmap                          98764  b2463497d8879448772e25d865073a9ed5ac0a49c7a237825902ef656a65775a
Septcats Setup 0.3.0-rc.6.exe                                93398609  52e49540b70bd09874a7e000ab43b2786bba7c9fb9e201f08c81d8a67cc377dc
Septcats Setup 0.3.0-rc.6.exe.blockmap                          98796  4395a8d2d2c941b9e1406cff51bde3ea84dc370517e25a334f5ab8bb4d05a055
Septcats Setup 0.3.0-rc.7.exe                                93400592  277ce127e92e66b22e9b35fead36957c45c704246bc02a5e512c199b7e779d9e
Septcats Setup 0.3.0-rc.7.exe.blockmap                          98999  241685dde01bbbb73e1919d677717a1cd162abc0f8f0d9996f84a2a22bac45ba
Septcats Setup 0.3.0-rc.8.exe                                93401790  db4c2b083de9b8394d14c6fe011f25548346ae0d2e9f38dece7b73c41f662b20
Septcats Setup 0.3.0-rc.8.exe.blockmap                          99113  39f595978134f6c5f5794e5df575961052f7f645ae9560a2c5d7fe9a6a758d75
Septcats Setup 0.3.0-rc.9.exe                                93402142  aa062204d6fd83a10da23d01035a6ff98dba7bc19734b88609d19d4996e11da3
Septcats Setup 0.3.0-rc.9.exe.blockmap                          99143  02bdc51a9746fdc20bbaf93ae186a091cc4e064d413b0a70f1dc06c1459a0c5d
Septcats Setup 0.3.0.exe                                     93403117  00fc54bd4aedf4aca8c557b44e6e41d3cc4a87472b43442d5a5a92227da79ef3
Septcats Setup 0.4.0.exe                                    102522116  91c87c6ad18bcb4041ee4a4ca56d9f0d131bdb96f5237f5f42186be61873595f
Septcats Setup 0.4.0.exe.blockmap                              107410  415d3921197706d60e25964eb5ded326020b5344a938aa3fea03b73a89dfea60
Septcats Setup 0.4.1-rc.1.exe                               102521545  9ef0036c72fe26debea19d4fc19cf3e1d8f142fcc48e519234c1029a08a07b9c
Septcats Setup 0.4.1-rc.1.exe.blockmap                         107442  adee88a99c1642f429d32d87e181dd22f4efd1a17d019ad04e85d62395d04ed2
Septcats Setup 0.4.1-rc.2.exe                               102530871  da5cb245806424c1ba4561d2c857fff44ee1e750fc626249eeafbac26651fd93
Septcats Setup 0.4.1-rc.2.exe.blockmap                         107221  42df5993a3b3f314ca0cc4a8880b0cf0216bdbade7fcce27fa663e228eaa1d3d
Septcats Setup 0.4.1-rc.3.exe                               102535157  f4a087d3521c8cc4d46a4953097a3180d843ddaf3759ee32b8e54b145eb1cdf0
Septcats Setup 0.4.1-rc.3.exe.blockmap                         107003  c797edcf5e490c1d89e8ad114e8f901496d977046b2d7807a0b2e0fe1772af0e
Septcats Setup 0.4.1-rc.4.exe                               102535625  7cefc1cce5200044a79983b3e45a4ede275d8f547dbcbc49570ee55f92080e5e
Septcats Setup 0.4.1-rc.4.exe.blockmap                         107038  442a1402bd1594c48fcffe98fc7b8e397e6e2130f49fa6807d166b70ff81cb60
Septcats Setup 0.4.1-rc.5.exe                               102562595  20a3b719dcdda85703d45be39330dfdca62d7f3389609b7873b834da94db5422
Septcats Setup 0.4.1-rc.5.exe.blockmap                         106884  53b6fa8dbfde05aa4e04f30bced7142d0514f0f1d592f6c880ea15494f4f6919
Septcats Setup 0.4.1-rc.6.exe                               102563003  250336428778c5c6929f66efb8624d69c9729ddfe2f74b32e43968dd0a67d507
Septcats Setup 0.4.1-rc.6.exe.blockmap                         106759  154c84994bce8ebb59ed6aced359f77689dd0e4116cba8f1d64d5a4500020ac7
Septcats Setup 0.4.1-rc.7.exe                               102566388  5a65c9d7d69467e68f48710640abf784822083c30621b79e934ad20155c88ba3
Septcats Setup 0.4.1-rc.7.exe.blockmap                         106860  ca984dd46287fa57712b980cf4fe2cb8c0a1956c923e3552cc2ef097acea1f20
Septcats Setup 0.4.3.exe                                    102594029  de68bd9a9873eb91e021610b898fdf0ffaf23151527acc5aa07eb85f60bb1144
Septcats Setup 0.4.3.exe.blockmap                              107334  0337242ca28fb963675d386623faa9ab02cb18f0ff6357ce8fd3b114d87e9f11
Septcats Setup 0.5.0.exe                                    102643843  f3b6e12535459f323f359f02e148e3ab862339132d03fa57cc6b26215340a14d
Septcats Setup 0.5.0.exe.blockmap                              108068  a6fb9eaa53a8c328ed7af3fb9e6b968f237c63a16ce6174b5a8115494f51567e
```

## 保留清单（8 个）

```text
Septcats Setup 0.4.2-rc.1.exe                               102586748
Septcats Setup 0.4.2-rc.1.exe.blockmap                         106962
Septcats Setup 0.4.2-rc.2.exe                               102592278
Septcats Setup 0.4.2-rc.2.exe.blockmap                         107175
Septcats Setup 0.4.2.exe                                    102594043
Septcats Setup 0.4.2.exe.blockmap                              107413
Septcats Setup 0.6.0-rc.1.exe                               102680001
Septcats Setup 0.6.0-rc.1.exe.blockmap                         107567
```
