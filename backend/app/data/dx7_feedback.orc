; Mark I feedback lookup tables, shared by all voices in this orchestra.
; The other half-cycle uses the same magnitude with complemented sign.
giDx7LogSine[] init 2048
iDx7Index = 0
while iDx7Index < 2048 do
 giDx7LogSine[iDx7Index] = round(-1024 * log2(sin((iDx7Index + 0.5) * $M_PI / 2048)))
 iDx7Index += 1
od

; Combine the 10-bit fractional exponential lookup and its integer right
; shift. At 13 octaves of attenuation even the largest mantissa shifts to zero.
giDx7Magnitude[] init 13313
iDx7Index = 0
while iDx7Index < lenarray(giDx7Magnitude) do
 iDx7Mantissa = round(4096 * 2^((1023 - iDx7Index % 1024) / 1024))
 giDx7Magnitude[iDx7Index] = floor(iDx7Mantissa / 2^int(iDx7Index / 1024))
 iDx7Index += 1
od
