n=int(input("enter a number"))
count=1
for i in range(18,51):
  if i%n==0 and count<=2:
   print(i,"is divisible by ",n)
   count +=1
  else:
    pass
