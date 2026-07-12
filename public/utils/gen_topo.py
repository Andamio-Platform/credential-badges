import math
import sys

W, H = 1600, 1600
RES = 8

def f(x, y):
    # Organic topographic noise using overlapping trig functions
    nx = x * 0.003
    ny = y * 0.003
    return (
        math.sin(nx)*math.cos(ny) * 2.0 + 
        math.sin(nx*2.3 + ny*1.1) * 1.0 + 
        math.cos(nx*4.1 - ny*3.5) * 0.5 + 
        math.sin(nx*7.8 + ny*8.2) * 0.25
    )

# Generate grid
grid = []
for y in range(0, H+RES, RES):
    row = []
    for x in range(0, W+RES, RES):
        row.append(f(x, y))
    grid.append(row)

# Contour levels
levels = [i * 0.4 for i in range(-15, 16)]

paths = []
# Marching squares algorithm
for ly in range(len(grid)-1):
    for lx in range(len(grid[0])-1):
        v00 = grid[ly][lx]
        v10 = grid[ly][lx+1]
        v01 = grid[ly+1][lx]
        v11 = grid[ly+1][lx+1]
        x0, y0 = lx*RES, ly*RES
        
        for level in levels:
            pts = []
            if (v00 >= level) != (v10 >= level):
                t = (level - v00) / (v10 - v00 + 1e-9)
                pts.append((x0 + t*RES, y0))
            if (v10 >= level) != (v11 >= level):
                t = (level - v10) / (v11 - v10 + 1e-9)
                pts.append((x0 + RES, y0 + t*RES))
            if (v01 >= level) != (v11 >= level):
                t = (level - v01) / (v11 - v01 + 1e-9)
                pts.append((x0 + t*RES, y0 + RES))
            if (v00 >= level) != (v01 >= level):
                t = (level - v00) / (v01 - v00 + 1e-9)
                pts.append((x0, y0 + t*RES))
            
            if len(pts) == 2:
                paths.append(f"M {pts[0][0]:.1f},{pts[0][1]:.1f} L {pts[1][0]:.1f},{pts[1][1]:.1f}")
            elif len(pts) == 4:
                # Handle saddle point gracefully
                paths.append(f"M {pts[0][0]:.1f},{pts[0][1]:.1f} L {pts[1][0]:.1f},{pts[1][1]:.1f}")
                paths.append(f"M {pts[2][0]:.1f},{pts[2][1]:.1f} L {pts[3][0]:.1f},{pts[3][1]:.1f}")

# Group into a single path for SVG performance
path_data = " ".join(paths)
svg = f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">\n'
svg += f'<path d="{path_data}" fill="none" stroke="#D3CDB7" stroke-width="1.2" opacity="0.65"/>\n'
svg += '</svg>'

with open("public/topo.svg", "w") as f:
    f.write(svg)

print("Created public/topo.svg successfully!")
