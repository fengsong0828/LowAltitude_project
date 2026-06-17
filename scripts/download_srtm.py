#!/usr/bin/env python3
"""
SRTM 地形数据下载 — 覆盖中国8城市所需的 1°×1° 瓦片
数据源: OpenTopography (无需认证，30m分辨率)
"""

import os
import sys
import urllib.request
import math

# Mapzen/Nextzen SRTM 数据源（免费，无认证）
SRTM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi"


def get_url(tile):
    """N39E116 → https://...skadi/N39/N39E116.hgt.gz"""
    lat_dir = tile[0]  # N or S
    lat_band = tile[:3]  # N39
    return f"{SRTM_URL}/{lat_band}/{tile}.hgt.gz"

# 8城所需 SRTM 瓦片（去重）
TILES = sorted(set([
    "N39E116", "N40E116",  # 北京
    "N31E121",              # 上海
    "N23E113",              # 广州
    "N22E113", "N22E114",  # 深圳
    "N29E106",              # 重庆
    "N30E104",              # 成都
    "N34E108",              # 西安
    "N30E120",              # 杭州
]))


def download_tile(tile, out_dir):
    hgt_path = os.path.join(out_dir, f"{tile}.hgt")
    if os.path.exists(hgt_path):
        print(f"  {tile} 已存在，跳过")
        return True

    url = get_url(tile)
    gz_path = os.path.join(out_dir, f"{tile}.hgt.gz")

    try:
        print(f"  {tile} 下载中... ", end="", flush=True)
        urllib.request.urlretrieve(url, gz_path)

        import gzip, shutil
        with gzip.open(gz_path, "rb") as f_in:
            with open(hgt_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

        os.remove(gz_path)
        size_mb = os.path.getsize(hgt_path) / 1024 / 1024
        print(f"OK ({size_mb:.1f} MB)")
        return True

    except Exception as e:
        print(f"失败: {e}")
        if os.path.exists(gz_path):
            os.remove(gz_path)
        return False


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "srtm")
    os.makedirs(out_dir, exist_ok=True)

    print("=" * 55)
    print("  SRTM GL1 地形数据下载 (30m 分辨率)")
    print(f"  覆盖城市: 8 | 所需瓦片: {len(TILES)}")
    print("=" * 55)

    ok = 0
    for tile in TILES:
        if download_tile(tile, out_dir):
            ok += 1

    print(f"\n  完成: {ok}/{len(TILES)} 瓦片下载成功")
    print(f"  目录: {out_dir}")

    if ok > 0:
        print(f"\n  提示: 启动服务后，在面板中开启「3D真实地形」即可查看山脉效果")
        print(f"        如未显示，请确保 serve.py 中 numpy 和 quantized-mesh-encoder 已安装")

    # 统计磁盘占用
    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir) if f.endswith('.hgt'))
    print(f"  磁盘占用: {total / 1024 / 1024:.0f} MB")


if __name__ == "__main__":
    main()
